import type { Course, Section } from '../catalog/types.ts';

// Client projections reuse catalog types while keeping raw Rutgers records on the server.
export type PlannerCourse = Pick<Course, 'id' | 'code' | 'title' | 'creditsLabel' | 'prerequisites' | 'notes'> & {
  sections: Omit<Section, 'raw'>[];
};
export interface Selection { course: Omit<PlannerCourse, 'sections'>; section: Omit<Section, 'raw'> }
export function plannerCourse(course: Course): PlannerCourse {
  return { id: course.id, code: course.code, title: course.title, creditsLabel: course.creditsLabel,
    prerequisites: course.prerequisites, notes: course.notes,
    sections: course.sections.map(({ id, index, number, instructors, meetings, campuses, availability, notices }) =>
      ({ id, index, number, instructors, meetings, campuses, availability, notices })) };
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
