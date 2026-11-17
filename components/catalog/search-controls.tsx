'use client';

import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function SearchControls({ query, subject, subjects, pathname = '/' }: {
  pathname?: string; query: string; subject: string; subjects: { code: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // Keep browser back/forward navigation reflected in the uncontrolled form.
  useEffect(() => {
    if (!form.current || form.current.contains(document.activeElement)) return;
    const input = form.current.elements.namedItem('q') as HTMLInputElement;
    const select = form.current.elements.namedItem('subject') as HTMLSelectElement;
    input.value = query;
    select.value = subject;
  }, [query, subject]);

  function navigate(): void {
    if (!form.current) return;
    const values = new FormData(form.current);
    const params = new URLSearchParams();
    const q = String(values.get('q') ?? '').trim();
    const department = String(values.get('subject') ?? '');
    if (q) params.set('q', q);
    if (department) params.set('subject', department);
    startTransition(() => router.replace(`${pathname}?${params}`, { scroll: false }));
  }
  return (
    <form ref={form} action={pathname} className="search-controls" role="search"
      onSubmit={event => { event.preventDefault(); if (timer.current) clearTimeout(timer.current); navigate(); }}>
      <div className="search-field">
        <label htmlFor="course-search">Find a course</label>
        <input id="course-search" name="q" type="search" defaultValue={query} maxLength={160}
          placeholder="Course title or code, e.g. 01:640:251" autoComplete="off"
          onChange={event => {
            if (timer.current) clearTimeout(timer.current);
            if (!('isComposing' in event.nativeEvent && event.nativeEvent.isComposing)) timer.current = setTimeout(navigate, 300);
          }} onCompositionEnd={() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(navigate, 300); }} />
      </div>
      <div className="subject-field">
        <label htmlFor="subject">Subject / department</label>
        <select id="subject" name="subject" defaultValue={subject}
          onChange={() => { if (timer.current) clearTimeout(timer.current); navigate(); }}>
          <option value="">All subjects</option>
          {subjects.map(item => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}
        </select>
      </div>
      <button className="button" type="submit">Search <span aria-hidden="true">↗</span></button>
      <span className="search-status" role="status">{pending ? 'Searching…' : 'Search by title or course code'}</span>
    </form>
  );
}
