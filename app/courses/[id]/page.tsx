import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findCourse } from '@/lib/catalog/search';
import { SectionList } from '@/components/catalog/section-list';
import { getCatalog, catalogSource } from '@/lib/catalog/server';

export default async function CoursePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { back } = await searchParams;
  const course = findCourse((await getCatalog()).byId, id);
  if (!course) notFound();
  // Only internal catalog queries are accepted as return destinations.
  const backHref = typeof back === 'string' && back.startsWith('/?') ? back : '/';
  return <main className="shell detail-shell">
    <Link className="back-link" href={backHref}>← Back to courses</Link>
    <header className="detail-header"><p className="eyebrow">{course.department} · {course.code}</p>
      <h1>{course.title}</h1><p>{course.creditsLabel} · {catalogSource.label} · Campus code {course.campusCode}{course.supplement ? ` · Variant ${course.supplement}` : ''}</p>
    </header>
    <aside className="snapshot-note"><strong>Snapshot information · capture time unknown</strong>
      <p>Open/closed labels reflect the downloaded catalog, not current availability. Check Rutgers SOC and WebReg before registration. An open seat does not establish eligibility.</p>
    </aside>
    {course.prerequisites && <section className="course-note"><h2>Prerequisites in the catalog</h2><p>{course.prerequisites}</p>
      <p className="muted">These are source notes, not a check of your academic record.</p></section>}
    {course.notes.length > 0 && <details className="course-notes"><summary>Course & department notes</summary>
      <dl>{course.notes.map(note => <div key={note.field}><dt>{note.field.replace(/([a-z])([A-Z])/g, '$1 $2')}</dt><dd>{note.text}</dd></div>)}</dl></details>}
    <div className="results-heading"><h2>Sections <span className="count">{course.sections.length}</span></h2>
      <p>Select a section for meetings and registration notes.</p></div>
    {course.sections.length ? <SectionList sections={course.sections} /> : <p className="empty-state">No sections were supplied in this snapshot.</p>}
    <p className="footnote">Registration eligibility has not been verified. Honors, permission, and other source codes may require confirmation with Rutgers.</p>
  </main>;
}
