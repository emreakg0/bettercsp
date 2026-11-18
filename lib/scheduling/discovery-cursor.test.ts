import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { decodeDiscoveryCursor, discoveryExpiration, discoverySecret, encodeDiscoveryCursor } from './discovery-cursor.ts';
import type { DiscoveryCheckpoint } from './discovery-state.ts';

const secret = 'a separate signing key for tests only';
const now = 1_800_000_000_000;
const expires = discoveryExpiration(now);
const binding = JSON.stringify(['term', 'catalog-hash', { weights: { lateEvenings: 4 }, profile: { school: 'private' } }]);
const state: DiscoveryCheckpoint = { frontier: { path: [3], next: 9 }, pending: [[2, 7]], windows: 1, visited: 25_000,
  evaluated: 4000, uniqueValid: 3500, retained: 60 };

test('cursor is stateless, expires, and omits private settings', () => {
  const token = encodeDiscoveryCursor(state, secret, binding, expires);
  assert.deepEqual(decodeDiscoveryCursor(token, secret, binding, now), { state, expires });
  const body = Buffer.from(token.split('.')[0], 'base64url').toString();
  assert.doesNotMatch(body, /private|school|weights|catalog-hash/);
  assert.throws(() => decodeDiscoveryCursor(token, secret, binding, expires), /invalid or expired/i);
  assert.equal(discoverySecret('short'), undefined);
  assert.equal(discoverySecret(secret), secret);
});

test('cursor rejects changed catalog, settings, secret, tampering, and excessive length', () => {
  const token = encodeDiscoveryCursor(state, secret, binding, expires);
  const [body, mac] = token.split('.');
  for (const forged of ['A'.repeat(6501), '.', body + '.' + (mac[0] === 'A' ? 'B' : 'A') + mac.slice(1)]) {
    assert.throws(() => decodeDiscoveryCursor(forged, secret, binding, now), /invalid or expired/i);
  }
  for (const changed of [binding.replace('catalog-hash', 'new-catalog'), binding.replace('4', '2')]) {
    assert.throws(() => decodeDiscoveryCursor(token, secret, changed, now), /invalid or expired/i);
  }
  assert.throws(() => decodeDiscoveryCursor(token, secret + ' rotated', binding, now), /invalid or expired/i);
});

test('even an authenticated cursor must use supported version, dimensions, ranges, and budgets', () => {
  for (const envelope of [
    { version: 0, expires, state },
    { version: 1, expires, state: { ...state, visited: 25_001 } },
    { version: 1, expires, state: { ...state, windows: 13 } },
    { version: 1, expires, state: { ...state, pending: [[-1]] } },
    { version: 1, expires, state: { ...state, frontier: { next: 1, path: Array(12).fill(0) } } },
    { version: 1, expires, state: { ...state, frontier: { next: 2002, path: [1] } } },
    { version: 1, expires: expires + 1, state },
  ]) {
    const body = Buffer.from(JSON.stringify(envelope)).toString('base64url');
    const mac = createHmac('sha256', secret).update(JSON.stringify([binding, body])).digest('base64url');
    assert.throws(() => decodeDiscoveryCursor(body + '.' + mac, secret, binding, now), /invalid or expired/i);
  }
});
