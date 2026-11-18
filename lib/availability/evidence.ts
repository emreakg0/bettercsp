import type { AvailabilityEvidence } from '../recovery/types.ts';
import type { Section } from '../catalog/types.ts';

export const availabilityUrl = 'https://classes.rutgers.edu/soc/api/openSections.json?year=2027&term=1&campus=NB';
export function snapshotEvidence(sourceId: string): AvailabilityEvidence {
  return { sourceId, state: 'snapshot', retrievedAt: null, checkedAt: null, openIndexes: [], message: 'Snapshot only; capture time is unknown. Check Rutgers SOC and WebReg before acting.' };
}
export function reportedAvailability(section: Pick<Section, 'id' | 'index' | 'availability'>, evidence: AvailabilityEvidence): Section['availability'] {
  // Only a scoped, complete, fresh verified list would justify interpreting absence as closed.
  if (evidence.state === 'fresh' && section.id.startsWith(`${evidence.sourceId}:`)) return evidence.openIndexes.includes(section.index) ? 'open' : 'closed';
  return section.availability;
}
export function parseOpenIndexes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100000 || !value.every(id => typeof id === 'string' && /^\d{5}$/.test(id)) || new Set(value).size !== value.length) throw new Error('Unsupported SOC open-sections response.');
  return value;
}
// A cache factory allows timestamp/failure tests without live SOC or Next.js dependencies.
export function createAvailabilityReader(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  let previous: AvailabilityEvidence | undefined, lastAttempt = -Infinity;
  let pending: Promise<AvailabilityEvidence> | undefined;
  return function read(sourceId: string): Promise<AvailabilityEvidence> {
    if (sourceId !== '2027-1-NB') return Promise.resolve(snapshotEvidence(sourceId));
    if (pending) return pending;
    if (previous && now() - lastAttempt < 60000) return Promise.resolve(previous);
    lastAttempt = now();
    pending = (async () => {
      try {
        const response = await fetcher(availabilityUrl, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('SOC unavailable');
        const text = await response.text();
        if (text.length > 1000000) throw new Error('SOC response too large');
        const indexes = parseOpenIndexes(JSON.parse(text));
        const timestamp = new Date(now()).toISOString();
        previous = { sourceId, state: 'unverified', retrievedAt: timestamp, checkedAt: timestamp, openIndexes: [],
          message: `SOC response retrieved (${indexes.length.toLocaleString('en-US')} indexes), but campus scope/completeness is unverified. Snapshot-only recovery; absence is not proof of closure.` };
      } catch {
        previous = { ...snapshotEvidence(sourceId), state: previous?.retrievedAt ? 'stale' : 'failed', retrievedAt: previous?.retrievedAt ?? null,
          checkedAt: new Date(now()).toISOString(), message: previous?.retrievedAt ? 'SOC check failed; prior unverified retrieval is stale. Recovery still uses snapshot availability.' : 'SOC check failed. Recovery uses the snapshot; current seats are unknown.' };
      }
      return previous!;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
