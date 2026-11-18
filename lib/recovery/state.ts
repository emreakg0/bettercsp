import { applyGenerated, readSavedIds, type Selection } from '../scheduling/selection.ts';
import { timetableIssues } from '../eligibility/preflight.ts';
import { exclusionReason } from '../scheduling/candidates.ts';
import { defaultConstraints, type HardConstraints } from '../scheduling/generation-types.ts';
import { registrationLabels, type RegistrationStatuses, type RescueDraft, type Repair } from './types.ts';

// Registration reports extend v1 local saves without changing legacy selected-ID/lock validation.
export function parseRegistrationStatuses(value: unknown, sourceId: string): RegistrationStatuses {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 200) throw new Error('Invalid registration reports.');
  const result: RegistrationStatuses = {};
  for (const [id, status] of Object.entries(value)) {
    if (!id.startsWith(`${sourceId}:`) || !/^\d{5}$/.test(id.slice(sourceId.length + 1)) || typeof status !== 'string' || !Object.hasOwn(registrationLabels, status)) throw new Error('Invalid registration report.');
    result[id] = status as RegistrationStatuses[string];
  }
  return result;
}
export function readSavedRegistration(value: string | null, sourceId: string): RegistrationStatuses {
  readSavedIds(value, sourceId);
  return value ? parseRegistrationStatuses((JSON.parse(value) as { registrationStatuses?: unknown }).registrationStatuses, sourceId) : {};
}
export function draftSignature(draft: RescueDraft): string {
  return JSON.stringify({ sections: draft.selections.map(s => [s.course.id, s.section.id]).sort(), locks: [...draft.locks].sort(), statuses: Object.entries(draft.statuses).sort() });
}
export function protectedSections(draft: RescueDraft): string[] {
  return [...new Set([...draft.locks, ...draft.selections.filter(s => draft.statuses[s.section.id] === 'registered').map(s => s.section.id)])].sort();
}
export function applyRepair(draft: RescueDraft, repair: Repair, basis: string, approvedOverrides: string[]): RescueDraft {
  if (basis !== draftSignature(draft)) throw new Error('Your schedule or registration reports changed. Search for repairs again.');
  const protectedIds = protectedSections(draft), after = repair.schedule.selections;
  const beforeCourses = draft.selections.map(s => s.course.id).sort();
  if (JSON.stringify(beforeCourses) !== JSON.stringify(after.map(s => s.course.id).sort())) throw new Error('A repair cannot silently remove or substitute a course.');
  const changed = draft.selections.filter(s => !after.some(a => a.section.id === s.section.id)).map(s => s.section.id);
  if (changed.some(id => protectedIds.includes(id) && !approvedOverrides.includes(id))) throw new Error('Explicit approval is required to change a registered or locked section.');
  const locks = draft.locks.filter(id => !changed.includes(id));
  const selections = applyGenerated(draft.selections, after, beforeCourses, protectedIds.filter(id => !approvedOverrides.includes(id)));
  const statuses = registrationAfterChange(draft.selections, selections, draft.statuses);
  return { selections, locks, statuses };
}
export function applyCourseFallback(draft: RescueDraft, targetId: string, replacement: Selection, basis: string, constraints: HardConstraints = defaultConstraints): RescueDraft {
  if (basis !== draftSignature(draft)) throw new Error('Your schedule or registration reports changed. Search for course alternatives again.');
  const target = draft.selections.find(selection => selection.section.id === targetId);
  const kept = draft.selections.filter(selection => selection !== target);
  if (!target || protectedSections(draft).includes(targetId)) throw new Error('A protected or missing section cannot be replaced with a course alternative.');
  if (replacement.section.id === targetId || kept.some(item => item.course.code === replacement.course.code || item.section.id === replacement.section.id)) {
    throw new Error('Choose a different section that is not already in your schedule.');
  }
  if (exclusionReason(replacement.section, constraints) || timetableIssues(replacement, [replacement, ...kept]).some(issue => issue.level !== 'verify')) {
    throw new Error('Check the proposed meeting times and campus gaps before applying.');
  }
  const selections = applyGenerated(draft.selections, [replacement], [target.course.id], protectedSections(draft));
  return { ...draft, selections, statuses: registrationAfterChange(draft.selections, selections, draft.statuses) };
}
export function registrationAfterChange(before: RescueDraft['selections'], after: RescueDraft['selections'], reports: RegistrationStatuses): RegistrationStatuses {
  const kept = new Set(after.map(s => s.section.id));
  const result = Object.fromEntries(Object.entries(reports).filter(([id, status]) => kept.has(id) || status === 'registered')) as RegistrationStatuses;
  for (const item of after) if (!before.some(old => old.section.id === item.section.id)) result[item.section.id] = 'planned';
  if (Object.keys(result).length > 200) throw new Error('Too many registration reports. Verify and clear old reports before applying.');
  return result;
}
export function undoRepair(current: RescueDraft, before: RescueDraft, expectedAfter: string): RescueDraft {
  if (draftSignature(current) !== expectedAfter) throw new Error('Reports, locks, or selections changed after applying. Undo is no longer safe.');
  return before;
}
