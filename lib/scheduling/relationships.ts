import type { Course, Section } from '../catalog/types.ts';

// Raw linkage evidence is interpreted separately from time overlap; no numbering rules are invented.
export function crossListedCodes(section: Section): string[] {
  const links = section.raw.crossListedSections;
  if (!Array.isArray(links)) return [];
  return links.flatMap(link => {
    if (!link || typeof link !== 'object') return [];
    const parts = [link.offeringUnitCode, link.subjectCode, link.courseNumber];
    return parts.every(p => typeof p === 'string' && /^\d+$/.test(p)) ? [parts.join(':')] : [];
  });
}
export function equivalentCourseGroups(courses: Course[]): Map<string, string> {
  const parent = new Map<string, string>();
  function root(code: string): string {
    const next = parent.get(code);
    if (!next || next === code) return code;
    const result = root(next); parent.set(code, result); return result;
  }
  for (const course of courses) {
    for (const code of course.sections.flatMap(crossListedCodes)) {
      const a = root(course.code), b = root(code);
      if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
    }
  }
  return new Map(courses.map(c => [c.id, root(c.code)]));
}
export function linkageNotices(course: Course, section: Section): string[] {
  const source = [course.prerequisites, ...course.notes.map(n => n.text), ...section.notices.map(n => n.text)];
  return source.filter(text => /co[ -]?requis|must (?:also )?(?:register|enroll)|linked|concurrent/i.test(text));
}
