/**
 * Scan write-buffer (Cloudflare Queues) — the /q/ hot path is decoupled from D1
 * WRITES so a viral scan spike can't throttle it. Design:
 * docs/superpowers/specs/2026-09-16-scan-write-buffer-design.md
 *
 * These are the four born-red cases from that spec, tested in isolation with a
 * fake D1 + fake Queue (no miniflare) so the enqueue/fallback/consumer decisions
 * are proven directly:
 *
 *   1. queue bound       → send the message, DO NOT write D1 (hot path shed of writes)
 *   2. consumer batch    → one batched write of BOTH rows per message, ack each
 *   3. send() throws      → fall back to the direct D1 batch (counts never lost)
 *   4. queue unbound     → direct D1 batch (dark-launch parity with today's code)
 *
 * never-who: the message carries only the same anonymized fields the rows already
 * store (pseudonymous anon id, ua hash, hour-bucket; never a country, OSE-1460) plus two separate
 * opaque row ids for retry idempotency — asserted below.
 */

import { describe, test, expect, vi } from 'vitest';
import {
  enqueueOrWriteScan,
  handleScanBatch,
  scanDedupKey,
  SCAN_QUEUE_MAX_RETRIES,
  type ScanMessage,
} from '../src/lib/scan-buffer';

/** Records every prepare()/bind()/batch() so tests can assert what would hit D1. */
function fakeDb() {
  const batches: Array<Array<{ sql: string; args: unknown[] }>> = [];
  const db = {
    batches,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return { sql, args };
        },
      };
    },
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      batches.push(stmts);
      return stmts.map(() => ({ success: true }));
    },
  };
  return db as unknown as D1Database & { batches: typeof batches };
}

/** Captures sent messages; can be made to throw to exercise the fallback. */
function fakeQueue(opts: { throwOnSend?: boolean } = {}) {
  const sent: ScanMessage[] = [];
  const queue = {
    sent,
    async send(msg: ScanMessage) {
      if (opts.throwOnSend) throw new Error('queue unavailable');
      sent.push(msg);
    },
  };
  return queue as unknown as Queue<ScanMessage> & { sent: ScanMessage[] };
}

const MSG: ScanMessage = {
  placement_row_id: 'spe_retry_stable_1',
  return_row_id: 'snr_retry_stable_1',
  event_id: 'evt_x',
  deployment_id: 'pd_1',
  anon_id: 'anon_abc',
  ua_hash: 'deadbeefdeadbeef',
  country: null,
  scan_bucket: '2026-09-16T20:00',
};

describe('enqueueOrWriteScan (hot-path producer)', () => {
  test('queue bound: sends the message and does NOT write D1', async () => {
    const DB = fakeDb();
    const SCAN_QUEUE = fakeQueue();

    const result = await enqueueOrWriteScan({ DB, SCAN_QUEUE }, MSG);

    expect(result).toBe('enqueued');
    expect(SCAN_QUEUE.sent).toEqual([MSG]); // exact message, only anonymized fields
    expect(DB.batches).toHaveLength(0); // the hot path wrote nothing to D1
  });

  test('send() throws: falls back to the direct D1 batch so counts are never lost', async () => {
    const DB = fakeDb();
    const SCAN_QUEUE = fakeQueue({ throwOnSend: true });

    const result = await enqueueOrWriteScan({ DB, SCAN_QUEUE }, MSG);

    expect(result).toBe('written');
    expect(DB.batches).toHaveLength(1);
    const stmts = DB.batches[0];
    expect(stmts).toHaveLength(2);
    expect(stmts.some((s) => s.sql.includes('scan_placement_events'))).toBe(true);
    expect(stmts.some((s) => s.sql.includes('scan_node_returns'))).toBe(true);
    expect(stmts.every((s) => s.sql.includes('INSERT OR IGNORE'))).toBe(true);
    expect(stmts[0].args[0]).toBe(MSG.placement_row_id);
    expect(stmts[1].args[0]).toBe(MSG.return_row_id);
  });

  test('queue unbound: uses the direct D1 batch (dark-launch parity with today)', async () => {
    const DB = fakeDb();

    const result = await enqueueOrWriteScan({ DB }, MSG);

    expect(result).toBe('written');
    expect(DB.batches).toHaveLength(1);
    expect(DB.batches[0]).toHaveLength(2);
    expect(DB.batches[0].map((s) => s.args[0])).toEqual([MSG.placement_row_id, MSG.return_row_id]);
  });
});

describe('handleScanBatch (queue consumer)', () => {
  test('writes both rows for every message in one batched call and acks each', async () => {
    const DB = fakeDb();
    const messages = [
      { body: MSG, ack: vi.fn(), retry: vi.fn() },
      {
        body: { ...MSG, deployment_id: 'pd_2', anon_id: 'anon_def' },
        ack: vi.fn(),
        retry: vi.fn(),
      },
    ];
    const batch = { queue: 'ose-scans', messages } as unknown as MessageBatch<ScanMessage>;

    await handleScanBatch(batch, { DB });

    // one batched D1 write, two rows (placement + return) per message
    expect(DB.batches).toHaveLength(1);
    expect(DB.batches[0]).toHaveLength(2 * messages.length);
    const placements = DB.batches[0].filter((s) => s.sql.includes('scan_placement_events'));
    const returns = DB.batches[0].filter((s) => s.sql.includes('scan_node_returns'));
    expect(placements).toHaveLength(messages.length);
    expect(returns).toHaveLength(messages.length);
    // every message acknowledged, none retried
    for (const m of messages) {
      expect(m.ack).toHaveBeenCalledTimes(1);
      expect(m.retry).not.toHaveBeenCalled();
    }
  });
});

describe('handleScanBatch — a dropped scan releases its dedup marker (OSE-1459)', () => {
  function failingDb() {
    return {
      prepare: () => ({ bind: (...args: unknown[]) => ({ args }) }),
      batch: async () => {
        throw new Error('D1 unavailable');
      },
    } as unknown as D1Database;
  }
  function fakeKv(keys: string[]) {
    const store = new Set(keys);
    return {
      store,
      kv: {
        delete: async (k: string) => {
          store.delete(k);
        },
      } as unknown as KVNamespace,
    };
  }
  const key = scanDedupKey(MSG.anon_id, MSG.deployment_id, MSG.scan_bucket);

  test('a failed write on an early attempt keeps the marker (Queues will retry)', async () => {
    const { store, kv } = fakeKv([key]);
    const message = { body: MSG, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    const batch = {
      queue: 'ose-scans',
      messages: [message],
    } as unknown as MessageBatch<ScanMessage>;

    await handleScanBatch(batch, { DB: failingDb(), RATE_LIMIT_KV: kv });

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(store.has(key)).toBe(true);
  });

  test('a failed write on the last attempt (about to dead-letter) deletes the marker', async () => {
    const { store, kv } = fakeKv([key]);
    const message = {
      body: MSG,
      attempts: SCAN_QUEUE_MAX_RETRIES + 1,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const batch = {
      queue: 'ose-scans',
      messages: [message],
    } as unknown as MessageBatch<ScanMessage>;

    await handleScanBatch(batch, { DB: failingDb(), RATE_LIMIT_KV: kv });

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(store.has(key)).toBe(false);
  });
});
