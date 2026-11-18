import type { Course } from '../catalog/types.ts';
import { reportedAvailability } from '../availability/evidence.ts';
import { evaluateEligibility } from '../eligibility/evaluate.ts';
import { emptyProfile } from '../eligibility/types.ts';
import { generateSchedules } from '../scheduling/generate.ts';
import { plannerCourse } from '../scheduling/selection.ts';
import type { RankedSchedule } from '../scheduling/generation-types.ts';
import { draftSignature, protectedSections } from './state.ts';
import { detectProblems } from './problems.ts';
import type { AvailabilityEvidence, Repair, RescueDraft, RescueRequest, RescueResult } from './types.ts';

function repair(schedule: RankedSchedule, draft: RescueDraft, request: RescueRequest, availability: AvailabilityEvidence): Repair {
  const changedIds = draft.selections.filter(s => !schedule.selections.some(after => after.section.id === s.section.id)).map(s => s.section.id);
  const introducedRestrictions: string[] = [];
  for (const after of schedule.selections) {
    const before = draft.selections.find(s => s.course.id === after.course.id)!;
    if (before.section.id === after.section.id) continue;
    const profile = request.settings.eligibility?.profile ?? emptyProfile;
    const known = new Set(evaluateEligibility(before.course, before.section, profile).findings.filter(f => f.status !== 'no-known-blocker').map(f => `${f.rule}:${f.message}`));
    for (const finding of evaluateEligibility(after.course, after.section, profile).findings) if (finding.status !== 'no-known-blocker' && !known.has(`${finding.rule}:${finding.message}`)) introducedRestrictions.push(`${after.course.code}, index ${after.section.index}: ${finding.message}`);
  }
  return { schedule, changedIds, before: draft.selections, introducedRestrictions,
    requiresReview: availability.state !== 'fresh' || schedule.eligibility.some(e => e.status !== 'no-known-blocker') };
}
// Recovery composes the Phase 3 solver; it never duplicates its feasibility or preference algorithms.
export function rescueSchedule(catalog: Course[], request: RescueRequest, availability: AvailabilityEvidence, maximumSteps = 25000): RescueResult {
  const selections = catalog.flatMap(c => c.sections.filter(s => request.sectionIds.includes(s.id)).map(section => {
    const { sections, ...course } = plannerCourse(c); return { course, section: sections.find(s => s.id === section.id)! };
  }));
  const draft: RescueDraft = { selections, statuses: request.statuses, locks: request.settings.constraints.lockedSectionIds };
  const protectedIds = protectedSections(draft).filter(id => !request.overrideProtectionIds.includes(id));
  const problems = detectProblems(draft, request, availability);
  const result: RescueResult = { basis: draftSignature(draft), problems, protectedIds, repairs: [], availability, issues: [], visited: 0, truncated: false, changeBudget: null };
  if (!selections.length || selections.length !== request.sectionIds.length || selections.length > 12 || new Set(selections.map(s => s.course.id)).size !== selections.length) {
    result.issues.push('Rescue needs 1–12 known sections, one per course. Resolve missing sections or duplicate course selections first.'); return result;
  }
  if (!problems.some(problem => problem.requiresReplacement || problem.source === 'timetable')) {
    result.issues.push('There is no timetable repair to make from this information alone. Verify the issue with Rutgers, or explicitly request a different section.');
    return result;
  }
  const replacing = new Set(problems.filter(p => p.requiresReplacement).map(p => p.sectionId));
  const blocked = protectedIds.filter(id => replacing.has(id));
  if (blocked.length) {
    result.issues.push(`Protected indexes ${blocked.map(id => id.split(':').at(-1)).join(', ')} have reported problems. Verify them in WebReg. Explicitly authorize exploration of these protected sections before Rescue can replace them.`); return result;
  }
  const profile = request.settings.eligibility?.profile ?? emptyProfile;
  const candidates = catalog.filter(c => selections.some(s => s.course.id === c.id)).map(course => ({ ...course, sections: course.sections.filter(section => {
    if (replacing.has(section.id)) return false;
    if (selections.some(s => s.section.id === section.id)) return true;
    const eligibility = evaluateEligibility(course, section, profile);
    return reportedAvailability(section, availability) !== 'closed' && !eligibility.confirmedIncompatible && eligibility.status !== 'permission-required';
  }) }));
  const minimum = replacing.size, maximum = selections.length - protectedIds.length;
  const budget = Number.isFinite(maximumSteps) ? Math.max(1, Math.min(50000, Math.floor(maximumSteps))) : 25000;
  for (let changes = minimum; changes <= maximum; changes++) {
    const settings = { ...request.settings, choices: selections.map(s => ({ courseId: s.course.id, required: true })),
      constraints: { ...request.settings.constraints, lockedSectionIds: protectedIds }, eligibility: { profile, excludeConfirmed: true } };
    const solved = generateSchedules(candidates, settings, { maxNodes: budget - result.visited, maxResults: 5, baseline: selections.map(s => ({ courseId: s.course.id, sectionId: s.section.id })), maxChanges: changes });
    result.visited += solved.visited; result.truncated = solved.truncated;
    if (solved.schedules.length) {
      result.repairs = solved.schedules.map(s => repair(s, draft, request, availability)); result.changeBudget = changes; break;
    }
    if (solved.truncated || result.visited >= budget) { result.truncated = true; break; }
    if (changes === maximum) result.issues.push(...solved.issues);
  }
  if (!result.repairs.length) result.issues.push(result.truncated
    ? 'No repair was found within the computation budget. Narrow exclusions or manually review one additional section; this is not proof that no repair exists.'
    : 'No repair can preserve these protected sections, courses, and hard constraints. Review the protected indexes and constraints; request department permission where indicated. Explicitly authorize protection changes to explore further.');
  return result;
}
