import 'server-only';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeCatalog } from '../rutgers/normalize.ts';
import type { CatalogSource } from './types.ts';

// Replace the adapter/source here for a future term; consumers do not depend on a filename.
export const catalogSource: CatalogSource = {
  id: '2027-1-NB', label: 'Spring 2027 · New Brunswick',
  file: 'data/rutgers/spring-2027.json', capturedAt: null,
};
async function loadCatalog() {
  const content = await readFile(path.join(process.cwd(), 'data', 'rutgers', path.basename(catalogSource.file)), 'utf8');
  const courses = normalizeCatalog(JSON.parse(content) as unknown, catalogSource)
    .sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
  const subjects = [...new Map(courses.map(c => [c.subject, c.department])).entries()]
    .map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
  const sectionCount = courses.reduce((total, course) => total + course.sections.length, 0);
  const revision = createHash('sha256').update(content).digest('hex');
  return { revision, courses, subjects, sectionCount, byId: new Map(courses.map(c => [c.id, c])) };
}
let catalog: ReturnType<typeof loadCatalog> | undefined;
export function getCatalog(): ReturnType<typeof loadCatalog> {
  // Share concurrent loads and retain normalized data; failed loads may be retried.
  catalog ??= loadCatalog().catch(error => { catalog = undefined; throw error; });
  return catalog;
}
