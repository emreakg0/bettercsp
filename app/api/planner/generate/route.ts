import { readJsonBody, JsonBodyError } from '@/lib/http/json';
import { catalogSource, getCatalog } from '@/lib/catalog/server';
import { generateSchedules, StaleDiscoveryError } from '@/lib/scheduling/generate';
import { decodeDiscoveryCursor, discoveryExpiration, discoverySecret, encodeDiscoveryCursor, InvalidDiscoveryCursor } from '@/lib/scheduling/discovery-cursor';
import { parseGenerationRequest } from '@/lib/scheduling/generation-request';

// A new read-only computation endpoint keeps bounded solving off the browser's main thread.
export async function POST(request: Request): Promise<Response> {
  let input: unknown;
  try { input = await readJsonBody(request); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid JSON settings.' }, { status: error instanceof JsonBodyError ? error.status : 400 }); }
  if (!input || typeof input !== 'object' || !('sourceId' in input) || input.sourceId !== catalogSource.id) {
    return Response.json({ error: 'This semester/campus catalog is not available. Reload the planner.' }, { status: 400 });
  }
  const cursor = 'discoveryCursor' in input ? input.discoveryCursor : undefined;
  const continuation = typeof cursor === 'string' ? /^(10|20|30|40|50):([a-f0-9]{64})$/.exec(cursor) : null;
  const secret = discoverySecret(process.env.PLANNER_DISCOVERY_SECRET);
  if (cursor !== undefined && cursor !== null && typeof cursor !== 'string') {
    return Response.json({ error: 'Invalid schedule continuation. Generate schedules again.' }, { status: 400 });
  }
  let settings;
  try { settings = parseGenerationRequest(input); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid generation settings.' }, { status: 400 }); }
  try {
    const catalog = await getCatalog();
    if (secret && cursor !== undefined) {
      const binding = JSON.stringify([catalogSource.id, catalog.revision, settings]);
      const resume = typeof cursor === 'string' ? decodeDiscoveryCursor(cursor, secret, binding) : null;
      const { checkpoint, ...result } = generateSchedules(catalog.courses, settings, { checkpoint: resume?.state ?? null });
      if (checkpoint && result.discovery) {
        result.discovery.nextCursor = encodeDiscoveryCursor(checkpoint, secret, binding, resume?.expires ?? discoveryExpiration());
      }
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    // Keep the original bounded shortlist available when no durable signing key is configured.
    if (typeof cursor === 'string' && !continuation) throw new InvalidDiscoveryCursor();
    const result = generateSchedules(catalog.courses, settings, {
      discoveryOffset: cursor === undefined ? undefined : Number(continuation?.[1] ?? 0),
      discoveryRevision: continuation?.[2],
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof StaleDiscoveryError || error instanceof InvalidDiscoveryCursor) return Response.json({ error: error.message }, { status: 409 });
    console.error('Schedule generation failed', error);
    return Response.json({ error: 'The catalog could not be processed. Your manual schedule is unchanged; retry generation.' }, { status: 503 });
  }
}
