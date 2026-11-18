import { readJsonBody, JsonBodyError } from '@/lib/http/json';
import { catalogSource, getCatalog } from '@/lib/catalog/server';
import { getAvailability } from '@/lib/availability/server';
import { snapshotEvidence } from '@/lib/availability/evidence';
import { parseCourseFallback, parseRescueRequest } from '@/lib/recovery/request';
import { rescueSchedule } from '@/lib/recovery/rescue';
import { findCourseFallbacks } from '@/lib/recovery/course-fallback';

// This endpoint computes proposals only; no WebReg credentials or enrollment writes exist.
export async function POST(request: Request): Promise<Response> {
  let input: unknown;
  try { input = await readJsonBody(request); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid JSON.' }, { status: error instanceof JsonBodyError ? error.status : 400 }); }
  if (!input || typeof input !== 'object' || !('sourceId' in input) || input.sourceId !== catalogSource.id) return Response.json({ error: 'Reload the supported semester/campus planner.' }, { status: 400 });
  let settings, courseFallback;
  try {
    settings = parseRescueRequest(input, catalogSource.id);
    if ('courseFallback' in input) courseFallback = parseCourseFallback(input.courseFallback, settings, catalogSource.id);
  }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid Rescue settings.' }, { status: 400 }); }
  try {
    if (courseFallback) return Response.json(findCourseFallbacks((await getCatalog()).courses, settings, courseFallback.targetId, courseFallback.candidateCodes), { headers: { 'Cache-Control': 'no-store' } });
    const availability = 'checkAvailability' in input && input.checkAvailability === true ? await getAvailability(catalogSource.id) : snapshotEvidence(catalogSource.id);
    return Response.json(rescueSchedule((await getCatalog()).courses, settings, availability), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Rescue could not read the catalog. Your draft is unchanged; retry or review sections manually.' }, { status: 503 });
  }
}
