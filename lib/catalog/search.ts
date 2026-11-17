import type { Course, SearchResult } from './types.ts';

export function searchCourses(courses: Course[], options: {
  query?: string; subject?: string; page?: number;
}): SearchResult {
  const query = (options.query ?? '').trim().toLowerCase().slice(0, 160);
  const tokens = query.split(/\s+/).filter(Boolean);
  const matched = courses.filter(course => (!options.subject || course.subject === options.subject)
    && tokens.every(token => course.searchText.includes(token)));
  const pages = Math.max(1, Math.ceil(matched.length / 30));
  const page = Math.max(1, Math.min(pages, Number.isFinite(options.page) ? Math.floor(options.page || 1) : 1));
  return { courses: matched.slice((page - 1) * 30, page * 30), total: matched.length, page, pages };
}

// Router versions may supply encoded or decoded params. Never use a route ID as a file path.
export function findCourse(byId: ReadonlyMap<string, Course>, routeId: string): Course | undefined {
  const exact = byId.get(routeId);
  if (exact) return exact;
  try { return byId.get(decodeURIComponent(routeId)); }
  catch { return undefined; }
}
