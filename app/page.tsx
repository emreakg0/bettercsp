import Link from 'next/link';
import { SearchControls } from '@/components/catalog/search-controls';
import { getCatalog, catalogSource } from '@/lib/catalog/server';
import { searchCourses } from '@/lib/catalog/search';

export default async function Home({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.slice(0, 160) : '';
  const subject = typeof params.subject === 'string' ? params.subject.slice(0, 10) : '';
  const requestedPage = typeof params.page === 'string' ? Number(params.page) : 1;
  const catalog = await getCatalog();
  const result = searchCourses(catalog.courses, { query, subject, page: requestedPage });
  function pageHref(page: number): string {
    return `/?${new URLSearchParams({ q: query, subject, page: String(page) })}`;
  }
  const back = pageHref(result.page);
  return <main className="shell">
    <header className="intro"><p className="eyebrow">YOUR NEXT SEMESTER, A LITTLE CLEARER</p>
      <h1>Find your next course.</h1><p>Explore Rutgers courses and the details that matter before registration.</p>
    </header>
    <div className="catalog-context"><span>{catalogSource.label}</span><span>{catalog.courses.length.toLocaleString('en-US')} courses · {catalog.sectionCount.toLocaleString('en-US')} sections</span></div>
    <SearchControls query={query} subject={subject} subjects={catalog.subjects} />
    <div className="results-heading"><h2>{query ? 'Search results' : 'Explore the catalog'}</h2>
      <p role="status">{result.total.toLocaleString('en-US')} {result.total === 1 ? 'course' : 'courses'}{query ? ` matching “${query}”` : ''}</p></div>
    {result.total === 0 ? <div className="empty-state"><h3>No courses found.</h3>
      <p>Try a shorter title, a course code like 01:640:251, or another subject.</p><Link href="/">Clear search and filters →</Link></div>
      : <ul className="course-list">{result.courses.map(course => <li key={course.id}>
        <Link prefetch={false} href={`/courses/${encodeURIComponent(course.id)}?${new URLSearchParams({ back })}`} className="course-row">
          <span className="course-code">{course.code}<small>{course.department}</small></span>
          <span className="course-title">{course.title}<small>{course.campusCode}{course.supplement ? ` · Variant ${course.supplement}` : ''}</small></span>
          <span className="course-meta">{course.creditsLabel}<small>{course.sections.length} sections</small></span>
          <span className="row-arrow" aria-hidden="true">↗</span>
        </Link>
      </li>)}</ul>}
    {result.pages > 1 && <nav className="pagination" aria-label="Search result pages">
      {result.page > 1 ? <Link href={pageHref(result.page - 1)}>← Previous</Link> : <span />}
      <span>Page {result.page} of {result.pages}</span>
      {result.page < result.pages ? <Link href={pageHref(result.page + 1)}>Next →</Link> : <span />}
    </nav>}
    <p className="footnote">A development snapshot, not a live seat check. Open does not mean eligible. Rutgers WebReg makes the final registration decision.</p>
  </main>;
}
