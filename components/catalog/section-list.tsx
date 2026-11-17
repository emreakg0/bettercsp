import type { Section } from '@/lib/catalog/types';

function time(minute: number | null): string {
  if (minute === null) return 'Time not specified';
  const hour = Math.floor(minute / 60);
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}
// SOC day-filter labels: https://classes.rutgers.edu/soc/ (verified 2026-11-17).
const days: Record<string, string> = { M: 'Mon', T: 'Tue', W: 'Wed', H: 'Thu', F: 'Fri', S: 'Sat', U: 'Sun' };
function day(code: string): string {
  // Keep unverified SOC day codes explicit rather than guessing their meaning.
  return days[code] ?? (code ? `Day code ${code}` : 'Day not specified');
}
function fieldLabel(field: string): string {
  return field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}
export function SectionList({ sections }: { sections: Section[] }) {
  return <div className="sections">{sections.map(section => (
    <details className="section" key={section.id}>
      <summary>
        <span className="section-name">Section {section.number}<small>Index <span className="index">{section.index}</span></small></span>
        <span className="section-instructor">{section.notices.some(n => n.field === 'Honors indicator') && <strong className="honors-label">Honors indicator · </strong>}{section.instructors.join(', ') || 'Instructor not listed'}</span>
        <span className={`badge ${section.availability}`}>{section.availability === 'unknown' ? 'Status unknown' : `${section.availability} in snapshot`}</span>
        <span className="expand" aria-hidden="true">+</span>
      </summary>
      <div className="section-body">
        <p className="muted">{section.campuses.join(' · ') || 'Campus not specified'} · Registration index: <strong className="index">{section.index}</strong></p>
        <ul className="meetings">{section.meetings.map((meeting, i) => <li key={i}>
          <div><strong>{day(meeting.dayCode)}</strong><span>{meeting.startMinute === null || meeting.endMinute === null
            ? 'Time not specified — verify with Rutgers' : `${time(meeting.startMinute)}–${time(meeting.endMinute)}`}</span></div>
          <div className="muted"><span>{meeting.mode || 'Meeting type not specified'}</span>
            <span>{[meeting.campus, meeting.building, meeting.room].filter(Boolean).join(' · ') || 'Location not specified'}</span></div>
        </li>)}</ul>
        
        {section.notices.length > 0 ? <div className="source-notes">
          <h3>Notes & potential restrictions</h3>
          <p className="muted">Source information, not an eligibility decision. Verify requirements with Rutgers.</p>
          <dl>{section.notices.map((notice, i) => <div key={i}><dt>{fieldLabel(notice.field)}</dt><dd>{notice.text}</dd></div>)}</dl>
        </div> : <p className="muted">No restriction notes were supplied for this section. This does not establish registration eligibility.</p>}
      </div>
    </details>
  ))}</div>;
}
