import { readJsonBody, JsonBodyError } from '@/lib/http/json';
import { catalogSource, getCatalog } from '@/lib/catalog/server';
import { getAvailability } from '@/lib/availability/server';
import { snapshotEvidence } from '@/lib/availability/evidence';
import { parseCourseFallback, parseRescueRequest } from '@/lib/recovery/request';
import { rescueSchedule } from '@/lib/recovery/rescue';
import { preparationLimit, preparationOptions } from '@/lib/recovery/prepared';
import { findCourseFallbacks } from '@/lib/recovery/course-fallback';

// This endpoint computes proposals only; no WebReg credentials or enrollment writes exist.
export async function POST(request: Request): Promise<Response> {
  let input: unknown;
  try { input = await readJsonBody(request); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid JSON.' }, { status: error instanceof JsonBodyError ? error.status : 400 }); }
  if (!input || typeof input !== 'object' || !('sourceId' in input) || input.sourceId !== catalogSource.id) return Response.json({ error: 'Reload the supported semester/campus planner.' }, { status: 400 });
  let settings: ReturnType<typeof parseRescueRequest>;
  let courseFallback: ReturnType<typeof parseCourseFallback> | undefined, targets: ReturnType<typeof parseCourseFallback>[] | undefined;
  try {
    settings = parseRescueRequest(input, catalogSource.id);
    if ('courseFallback' in input) courseFallback = parseCourseFallback(input.courseFallback, settings, catalogSource.id);
    if ('prepareBackups' in input) {
      const raw = input.prepareBackups;
      if (courseFallback || !Array.isArray(raw) || !raw.length || raw.length > preparationLimit ||
          settings.replaceSectionIds.length || settings.overrideProtectionIds.length) throw new Error('Invalid backup preparation request.');
      targets = raw.map(target => parseCourseFallback(target, settings, catalogSource.id));
      if (new Set(targets.map(target => target.targetId)).size !== targets.length || targets.some(({ targetId }) =>
        settings.statuses[targetId] === 'registered' || settings.settings.constraints.lockedSectionIds.includes(targetId))) {
        throw new Error('Backups can only be prepared for distinct, unprotected sections.');
      }
    }
  }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid Rescue settings.' }, { status: 400 }); }
  try {
    if (targets) {
      const catalog = await getCatalog();
      const budget = Math.min(1800, Math.floor(12000 / targets.length));
      const entries = targets.map(({ targetId, candidateCodes }) => {
        const result = findCourseFallbacks(catalog.courses, settings, targetId, candidateCodes, budget);
        const seen = new Map<string, number>();
        const sameCourseCode = catalog.courses.find(course => course.sections.some(section => section.id === targetId))?.code;
        const options = result.options.filter(({ selection }) => {
          const code = selection.course.code;
          const count = seen.get(code) ?? 0;
          seen.set(code, count + 1);
          return count < (code === sameCourseCode ? 2 : 1);
        }).slice(0, preparationOptions);
        return { targetId, options, truncated: result.truncated };
      });
      return Response.json({ catalogRevision: catalog.revision, entries }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (courseFallback) return Response.json(findCourseFallbacks((await getCatalog()).courses, settings, courseFallback.targetId, courseFallback.candidateCodes), { headers: { 'Cache-Control': 'no-store' } });
    const availability = 'checkAvailability' in input && input.checkAvailability === true ? await getAvailability(catalogSource.id) : snapshotEvidence(catalogSource.id);
    return Response.json(rescueSchedule((await getCatalog()).courses, settings, availability), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Rescue could not read the catalog. Your draft is unchanged; retry or review sections manually.' }, { status: 503 });
  }
}
