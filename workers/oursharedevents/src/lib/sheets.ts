/**
 * Google Sheets API read client.
 *
 * Thin wrapper over the Sheets v4 REST API.
 * All data access for Phase 1 goes through this file.
 *
 * D1 Migration note (Phase 2):
 *   Replace this file with src/lib/d1.ts.
 *   Handler imports swap from `./sheets` → `./d1` with the same function signatures.
 */

import { getGoogleAccessToken, type GoogleAuthEnv } from './google-auth';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SheetsEnv extends GoogleAuthEnv {
  SHEETS_SPREADSHEET_ID?: string;
}

export class SheetsReadError extends Error {
  readonly googleStatus?: number;
  readonly googleBody?: string;

  constructor(message: string, googleStatus?: number, googleBody?: string) {
    super(message);
    this.name = 'SheetsReadError';
    this.googleStatus = googleStatus;
    this.googleBody = googleBody ? googleBody.slice(0, 400) : undefined;
  }
}

// ─── Implementation ────────────────────────────────────────────────────────────

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Read a range from a Google Sheets spreadsheet.
 *
 * @param env  - Worker environment (must have SA credentials + spreadsheet ID)
 * @param range - A1 notation, e.g. `EVENTS!A2:K`
 * @returns 2D array of string values (empty array if range is empty)
 */
export async function sheetsGetValues(env: SheetsEnv, range: string): Promise<string[][]> {
  if (!env.SHEETS_SPREADSHEET_ID) {
    throw new SheetsReadError('SHEETS_SPREADSHEET_ID not configured');
  }

  const token = await getGoogleAccessToken(env);
  const url = `${SHEETS_API}/${env.SHEETS_SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new SheetsReadError(`Sheets API error: HTTP ${res.status}`, res.status, body);
    }

    const data = await res.json() as { values?: string[][] };
    return data.values ?? [];
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof SheetsReadError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SheetsReadError('Sheets API request timed out after 10000ms');
    }
    throw new SheetsReadError('fetch failed');
  }
}
