#!/usr/bin/env node
/**
 * One-shot helper for OSE-320: appends the "10. UEC Resolve" item
 * group to postman/collections/ose-api.json. Re-runnable (idempotent —
 * detects existing group by name, including the pre-rename "10. UEC QR
 * Generation" name, and replaces). Re-usable for future UEC endpoint
 * additions in the same group.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const COLLECTION_PATH = 'postman/collections/ose-api.json';
const NEW_GROUP_NAME = '10. UEC Resolve';
// Pre-rename name kept so re-running this script after the in-PR rename
// from "/api/v2/qr/generate" → "/api/v2/uec/resolve" replaces cleanly
// instead of leaving a stale group around.
const OLD_GROUP_NAME = '10. UEC QR Generation';

const uecGroup = {
  name: NEW_GROUP_NAME,
  description:
    'OSE-320 — UEC resolve endpoint. Resolves canonical UEC code identifiers to full metadata + a rendered QR data URI. UEC is the semantic-category contract for any URL the platform emits (QR, shortlinks, deep links); this endpoint serves the QR-render case first. Stateless, no auth, edge-cacheable.',
  item: [
    {
      name: 'OSE-320 | API | GET /api/v2/uec/resolve?code=green (canonical label) | 200 with code metadata + QR',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "const json = pm.response.json();",
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "pm.test('ok is true', () => pm.expect(json.ok).to.be.true);",
              "pm.test('code.id is ENTER (matched by green label)', () => pm.expect(json.code.id).to.eql('ENTER'));",
              "pm.test('code.scan_hex is canonical', () => pm.expect(json.code.scan_hex).to.eql('#1A6B2F'));",
              "pm.test('code.display_hex is canonical', () => pm.expect(json.code.display_hex).to.eql('#2D6A4F'));",
              "pm.test('code.wcag_grade is AAA', () => pm.expect(json.code.wcag_grade).to.eql('AAA'));",
              "pm.test('qr.data_uri is PNG data URI', () => pm.expect(json.qr.data_uri).to.match(/^data:image\\/png;base64,/));",
              "pm.test('qr.encoded_url uses request origin', () => pm.expect(json.qr.encoded_url).to.match(/\\/enter$/));",
              "pm.test('uec_version is 1.1', () => pm.expect(json.uec_version).to.eql('1.1'));",
              "pm.test('Cache-Control header set (edge-cacheable)', () => {",
              "    const cc = pm.response.headers.get('Cache-Control');",
              "    pm.expect(cc).to.match(/max-age=\\d+/);",
              "});",
            ],
          },
        },
      ],
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: '{{baseUrl}}/api/v2/uec/resolve?code=green',
          host: ['{{baseUrl}}'],
          path: ['api', 'v2', 'uec', 'resolve'],
          query: [{ key: 'code', value: 'green' }],
        },
      },
    },
    {
      name: 'OSE-320 | API | GET /api/v2/uec/resolve?code=SPONSOR (canonical id) | 200 with blue hex',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "const json = pm.response.json();",
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "pm.test('code.id is SPONSOR', () => pm.expect(json.code.id).to.eql('SPONSOR'));",
              "pm.test('code.label is Blue', () => pm.expect(json.code.label).to.eql('Blue'));",
              "pm.test('code.scan_hex is canonical sponsor blue', () => pm.expect(json.code.scan_hex).to.eql('#1A3A8A'));",
              "pm.test('code.url_path is /sponsor', () => pm.expect(json.code.url_path).to.eql('/sponsor'));",
            ],
          },
        },
      ],
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: '{{baseUrl}}/api/v2/uec/resolve?code=SPONSOR',
          host: ['{{baseUrl}}'],
          path: ['api', 'v2', 'uec', 'resolve'],
          query: [{ key: 'code', value: 'SPONSOR' }],
        },
      },
    },
    {
      name: 'OSE-320 | API | GET /api/v2/uec/resolve?code=%20GREEN%20 (whitespace + uppercase) | 200 still resolves ENTER',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "const json = pm.response.json();",
              "pm.test('Status is 200', () => pm.response.to.have.status(200));",
              "pm.test('code.id is ENTER (whitespace + case tolerated)', () => pm.expect(json.code.id).to.eql('ENTER'));",
            ],
          },
        },
      ],
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: '{{baseUrl}}/api/v2/uec/resolve?code=%20GREEN%20',
          host: ['{{baseUrl}}'],
          path: ['api', 'v2', 'uec', 'resolve'],
          query: [{ key: 'code', value: '%20GREEN%20' }],
        },
      },
    },
    {
      name: 'OSE-320 | API | GET /api/v2/uec/resolve (no code param) | 400 MISSING_CODE with valid_codes list',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "const json = pm.response.json();",
              "pm.test('Status is 400', () => pm.response.to.have.status(400));",
              "pm.test('ok is false', () => pm.expect(json.ok).to.be.false);",
              "pm.test('error is MISSING_CODE', () => pm.expect(json.error).to.eql('MISSING_CODE'));",
              "pm.test('valid_codes.ids includes all 11 canonical', () => {",
              "    pm.expect(json.valid_codes.ids).to.have.lengthOf(11);",
              "    pm.expect(json.valid_codes.ids).to.include('ENTER');",
              "    pm.expect(json.valid_codes.ids).to.include('SHOP');",
              "});",
              "pm.test('valid_codes.labels includes all 11', () => {",
              "    pm.expect(json.valid_codes.labels).to.have.lengthOf(11);",
              "});",
              "pm.test('message uses friendly voice (no raw stack trace)', () => {",
              "    pm.expect(json.message).to.not.match(/TypeError|undefined|at .*\\.ts:/);",
              "    pm.expect(json.message.toLowerCase()).to.match(/required|canonical|provide/);",
              "});",
            ],
          },
        },
      ],
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: '{{baseUrl}}/api/v2/uec/resolve',
          host: ['{{baseUrl}}'],
          path: ['api', 'v2', 'uec', 'resolve'],
        },
      },
    },
    {
      name: 'OSE-320 | API | GET /api/v2/uec/resolve?code=xyz (non-canonical) | 400 INVALID_CODE',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "const json = pm.response.json();",
              "pm.test('Status is 400', () => pm.response.to.have.status(400));",
              "pm.test('error is INVALID_CODE', () => pm.expect(json.error).to.eql('INVALID_CODE'));",
              "pm.test('invalid_code echoed back', () => pm.expect(json.invalid_code).to.eql('xyz'));",
              "pm.test('valid_codes.ids present and complete', () => {",
              "    pm.expect(json.valid_codes.ids).to.eql(['ENTER','LIVE','SPONSOR','ARCHIVE','HELP','FEEDBACK','UTILITY','ALERT','STAFF','CHECK-IN','SHOP']);",
              "});",
              "pm.test('message uses friendly voice', () => {",
              "    pm.expect(json.message).to.match(/canonical/i);",
              "});",
            ],
          },
        },
      ],
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: '{{baseUrl}}/api/v2/uec/resolve?code=xyz',
          host: ['{{baseUrl}}'],
          path: ['api', 'v2', 'uec', 'resolve'],
          query: [{ key: 'code', value: 'xyz' }],
        },
      },
    },
  ],
};

const raw = readFileSync(COLLECTION_PATH, 'utf8');
const collection = JSON.parse(raw);

// Idempotent: replace existing group if it exists (either current or
// pre-rename name), else append. The OR-match makes this script safe to
// re-run on a collection that still has the pre-rename "UEC QR Generation"
// group from the earlier OSE-320 commit.
const existingIdx = collection.item.findIndex(
  (g) => g.name === NEW_GROUP_NAME || g.name === OLD_GROUP_NAME
);
if (existingIdx >= 0) {
  const oldName = collection.item[existingIdx].name;
  collection.item[existingIdx] = uecGroup;
  console.log(`Replaced "${oldName}" group with "${NEW_GROUP_NAME}" (idx ${existingIdx})`);
} else {
  collection.item.push(uecGroup);
  console.log(`Appended new "${NEW_GROUP_NAME}" group (now ${collection.item.length} top-level groups)`);
}

writeFileSync(COLLECTION_PATH, JSON.stringify(collection, null, 2) + '\n', 'utf8');
console.log(`Wrote ${COLLECTION_PATH} (${uecGroup.item.length} new items in the group)`);
