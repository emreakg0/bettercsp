import type { ReactNode } from 'react';
import { formatTime as time, formatDay as day } from '@/lib/scheduling/meetings';
import type { Section } from '@/lib/catalog/types';

function fieldLabel(field: string): string {
  return field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}
export function SectionList({ sections, renderAction }: { sections: Omit<Section, 'raw'>[]; renderAction?: (section: Omit<Section, 'raw'>) => ReactNode }) {
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
        {section.meetings.length === 0 && <p className="muted">No meeting times supplied — verify with Rutgers.</p>}
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
        {renderAction?.(section)}
      </div>
    </details>
  ))}</div>;
}
