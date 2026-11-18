import { applyGenerated, readSavedIds } from '../scheduling/selection.ts';
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
