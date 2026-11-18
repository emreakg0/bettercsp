import { catalogSource, getCatalog } from '@/lib/catalog/server';
import { plannerCourse, type Selection } from '@/lib/scheduling/selection';

// Resolve saved identities against the trusted catalog rather than persisting copied metadata.
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const ids = params.getAll('id');
  const courseId = params.get('course');
  if (courseId !== null && (ids.length || params.getAll('course').length !== 1 || courseId.length > 180 || !courseId.startsWith(catalogSource.id + '~'))) {
    return Response.json({ error: 'Invalid course identifier' }, { status: 400 });
  }
  if (ids.length > 100 || ids.some(id => !id.startsWith(`${catalogSource.id}:`) || !/^\d{5}$/.test(id.slice(catalogSource.id.length + 1)))) {
    return Response.json({ error: 'Invalid section identifiers' }, { status: 400 });
  }
  try {
    const catalog = await getCatalog();
    if (courseId !== null) {
      const course = catalog.byId.get(courseId);
      if (!course) return Response.json({ error: 'Course not found' }, { status: 404 });
      if (course.sections.length > 250) return Response.json({ error: 'Too many sections to preview. Check the Rutgers Schedule of Classes.' }, { status: 422 });
      return Response.json({ sections: plannerCourse(course).sections }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const wanted = new Set(ids);
    const selections: Selection[] = [];
    for (const course of catalog.courses) {
      if (!course.sections.some(section => wanted.has(section.id))) continue;
      const { sections, ...info } = plannerCourse(course);
      for (const section of sections) if (wanted.has(section.id)) selections.push({ course: info, section });
    }
    return Response.json({ selections }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Catalog unavailable. Retry loading your saved schedule.' }, { status: 503 });
  }
}
