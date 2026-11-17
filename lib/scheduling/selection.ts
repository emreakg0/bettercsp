import type { Course, Section } from '../catalog/types.ts';
import { findConflicts } from './meetings.ts';

// Client projections reuse catalog types while keeping raw Rutgers records on the server.
export type PlannerCourse = Pick<Course, 'id' | 'code' | 'title' | 'creditsLabel' | 'prerequisites' | 'notes'> & {
  sections: Omit<Section, 'raw'>[];
};
export interface Selection { course: Omit<PlannerCourse, 'sections'>; section: Omit<Section, 'raw'> }
export function plannerCourse(course: Course): PlannerCourse {
  return { id: course.id, code: course.code, title: course.title, creditsLabel: course.creditsLabel,
    prerequisites: course.prerequisites, notes: course.notes,
    sections: course.sections.map(({ id, index, number, instructors, meetings, campuses, availability, notices, delivery, honors }) =>
      ({ id, index, number, instructors, meetings, campuses, availability, notices, delivery, honors })) };
}
export function selectSection(current: Selection[], course: PlannerCourse, section: Selection['section']): Selection[] {
  const { sections: _sections, ...info } = course;
  void _sections;
  const selection = { course: info, section };
  const existing = current.findIndex(item => item.course.id === course.id);
  return existing < 0 ? [...current, selection] : current.map((item, i) => i === existing ? selection : item);
}
export function storageKey(sourceId: string): string { return `bettercsp:planner:v1:${sourceId}`; }
export function readSavedIds(value: string | null, sourceId: string): string[] {
  if (value === null) return [];
  const saved: unknown = JSON.parse(value);
  if (!saved || typeof saved !== 'object' || !('version' in saved) || saved.version !== 1
    || !('sourceId' in saved) || saved.sourceId !== sourceId || !('sectionIds' in saved)
    || !Array.isArray(saved.sectionIds) || saved.sectionIds.length > 100
    || !saved.sectionIds.every(id => typeof id === 'string' && id.startsWith(`${sourceId}:`) && /^\d{5}$/.test(id.slice(sourceId.length + 1)))) {
    throw new Error('Unsupported or invalid saved schedule');
  }
  return [...new Set(saved.sectionIds as string[])];
}

// Version 1 saves gain an optional lock list; older ID-only saves remain valid.
export function readSavedLocks(value: string | null, sourceId: string): string[] {
  const selected = readSavedIds(value, sourceId);
  if (!value) return [];
  const saved = JSON.parse(value) as { lockedSectionIds?: unknown };
  if (saved.lockedSectionIds === undefined) return [];
  if (!Array.isArray(saved.lockedSectionIds) || !saved.lockedSectionIds.every(id => typeof id === 'string' && selected.includes(id))) {
    throw new Error('Invalid saved locks');
  }
  return [...new Set(saved.lockedSectionIds as string[])];
}
export function applyGenerated(current: Selection[], generated: Selection[], targetCourseIds: string[], lockedIds: string[]): Selection[] {
  const remaining = current.filter(s => !targetCourseIds.includes(s.course.id) && !generated.some(g => g.course.id === s.course.id));
  const next = [...remaining, ...generated];
  if (new Set(next.map(s => s.course.id)).size !== next.length || next.length > 100) throw new Error('Generated choices conflict with retained courses.');
  if (findConflicts(next.map(s => s.section)).length) throw new Error('Generated choices overlap retained sections. Generate again with the current draft.');
  if (lockedIds.some(id => !next.some(s => s.section.id === id))) throw new Error('A locked section changed. Generate again with your current locks.');
  return next;
}
