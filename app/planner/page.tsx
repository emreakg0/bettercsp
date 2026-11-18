import Link from 'next/link';
import { SearchControls } from '@/components/catalog/search-controls';
import { PlannerWorkspace } from '@/components/planner/workspace';
import { catalogSource, getCatalog } from '@/lib/catalog/server';
import { searchCourses } from '@/lib/catalog/search';
import { plannerCourse } from '@/lib/scheduling/selection';

// Server-side search reuses the catalog adapter; only the current result page reaches the client.
export default async function PlannerPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.slice(0, 160) : '';
  const subject = typeof params.subject === 'string' ? params.subject.slice(0, 10) : '';
  const catalog = await getCatalog();
  const result = searchCourses(catalog.courses, { query, subject, page: typeof params.page === 'string' ? Number(params.page) : 1 });
  const pageHref = (page: number): string => `/planner?${new URLSearchParams({ q: query, subject, page: String(page) })}`;
  return <main className="shell planner-shell">
    <header className="intro"><h1>Build your semester.</h1></header>
    <div className="catalog-context"><span>{catalogSource.label}</span><Link className="back-link" href="/">Browse Course Explorer ↗</Link></div>
    <p className="muted planner-source-note">Seat labels use a snapshot. Verify availability and eligibility with Rutgers; applying a plan does not register you.</p>
    <PlannerWorkspace sourceId={catalogSource.id} courses={result.courses.map(plannerCourse)}>
      <div id="planner-search"><SearchControls pathname="/planner" query={query} subject={subject} subjects={catalog.subjects} /></div>
      <div className="results-heading"><h2>Find your courses</h2><p role="status">{result.total.toLocaleString('en-US')} {result.total === 1 ? 'course' : 'courses'}</p></div>
      {result.total === 0 && <div className="empty-state"><h3>No courses found.</h3><p>Try a shorter title, course code, or another subject.</p><Link href="/planner">Clear search and filters →</Link></div>}
      {result.pages > 1 && <nav className="pagination" aria-label="Planner search result pages">
        {result.page > 1 ? <Link href={pageHref(result.page - 1)} scroll={false}>← Previous</Link> : <span />}
        <span>Page {result.page} of {result.pages}</span>
        {result.page < result.pages ? <Link href={pageHref(result.page + 1)} scroll={false}>Next →</Link> : <span />}
      </nav>}
    </PlannerWorkspace>
  </main>;
}
