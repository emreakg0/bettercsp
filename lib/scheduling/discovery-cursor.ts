import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  discoveryPageSize, discoveryWindowLimit, discoveryWindowSteps, initialShortlistSize, type DiscoveryCheckpoint,
} from './discovery-state.ts';

// The signature covers private settings as context, so the cursor body contains only ordinals and counters.
const lifetime = 30 * 60_000;
const maxCursorLength = 6500;
const maxSteps = discoveryWindowLimit * discoveryWindowSteps;
const version = 1;

export class InvalidDiscoveryCursor extends Error {
  constructor() { super('This schedule continuation is invalid or expired. Generate schedules again.'); }
}
export function discoverySecret(value: string | undefined): string | undefined {
  return value && Buffer.byteLength(value.trim()) >= 32 ? value : undefined;
}
function signature(body: string, secret: string, binding: string): Buffer {
  return createHmac('sha256', secret).update(JSON.stringify([binding, body])).digest();
}
function integer(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
function stateObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function ordinals(value: unknown, min: number, max: number): boolean {
  return Array.isArray(value) && value.length >= min && value.length <= max && value.every(i => integer(i, 2000));
}
function checkpoint(value: unknown): value is DiscoveryCheckpoint {
  if (!stateObject(value)) return false;
  const { frontier, pending, windows, visited, evaluated, uniqueValid, retained } = value;
  if (!integer(windows, discoveryWindowLimit) || windows < 1 || !integer(visited, maxSteps)
    || visited < 1 || visited > windows * discoveryWindowSteps || !integer(evaluated, visited) || !integer(uniqueValid, evaluated)
    || !integer(retained, Math.min(uniqueValid, initialShortlistSize + (windows - 1) * discoveryPageSize))) return false;
  if (!Array.isArray(pending) || pending.length > (windows === 1 ? initialShortlistSize - discoveryPageSize : 0) || pending.length > retained
    || !pending.every(row => ordinals(row, 1, 12))) return false;
  if (frontier !== null && (!stateObject(frontier) || !ordinals(frontier.path, 0, 11) || !integer(frontier.next, 2001))) return false;
  return pending.length > 0 || (frontier !== null && windows < discoveryWindowLimit);
}
export function encodeDiscoveryCursor(state: DiscoveryCheckpoint, secret: string, binding: string, expires: number): string {
  const body = Buffer.from(JSON.stringify({ version, expires, state })).toString('base64url');
  const token = body + '.' + signature(body, secret, binding).toString('base64url');
  if (token.length > maxCursorLength) throw new Error('Schedule checkpoint exceeds its size limit.');
  return token;
}
export function discoveryExpiration(now = Date.now()): number { return now + lifetime; }
export function decodeDiscoveryCursor(token: string, secret: string, binding: string, now = Date.now()): {
  state: DiscoveryCheckpoint; expires: number;
} {
  if (token.length > maxCursorLength || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) throw new InvalidDiscoveryCursor();
  const [body, signed] = token.split('.');
  const expected = signature(body, secret, binding);
  const supplied = Buffer.from(signed, 'base64url');
  if (supplied.toString('base64url') !== signed || !timingSafeEqual(expected, supplied)) throw new InvalidDiscoveryCursor();
  let value: unknown;
  try { value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { throw new InvalidDiscoveryCursor(); }
  if (!stateObject(value) || value.version !== version || !integer(value.expires, discoveryExpiration(now))
    || value.expires <= now || !checkpoint(value.state)) throw new InvalidDiscoveryCursor();
  return { state: value.state, expires: value.expires };
}
