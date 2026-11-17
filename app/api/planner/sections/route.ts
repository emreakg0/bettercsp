import { catalogSource, getCatalog } from '@/lib/catalog/server';
import { plannerCourse, type Selection } from '@/lib/scheduling/selection';

// Resolve saved identities against the trusted catalog rather than persisting copied metadata.
export async function GET(request: Request): Promise<Response> {
  const ids = new URL(request.url).searchParams.getAll('id');
  if (ids.length > 100 || ids.some(id => !id.startsWith(`${catalogSource.id}:`) || !/^\d{5}$/.test(id.slice(catalogSource.id.length + 1)))) {
    return Response.json({ error: 'Invalid section identifiers' }, { status: 400 });
  }
  try {
    const wanted = new Set(ids);
    const selections: Selection[] = [];
    for (const course of (await getCatalog()).courses) {
      if (!course.sections.some(section => wanted.has(section.id))) continue;
      const { sections, ...info } = plannerCourse(course);
      for (const section of sections) if (wanted.has(section.id)) selections.push({ course: info, section });
    }
    return Response.json({ selections }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Catalog unavailable. Retry loading your saved schedule.' }, { status: 503 });
  }
}
