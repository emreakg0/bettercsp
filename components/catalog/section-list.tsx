import type { ReactNode } from 'react';
import { formatTime as time, formatDay as day } from '@/lib/scheduling/meetings';
import type { Section } from '@/lib/catalog/types';

function fieldLabel(field: string): string {
  return field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}
function SectionWarning({ text }: { text: string }) {
  return text ? <span className="section-preflight-warning">{text}</span> : null;
}
export function SectionList({ sections, renderAction, warning, initiallyOpen }: { sections: Omit<Section, 'raw'>[]; renderAction?: (section: Omit<Section, 'raw'>) => ReactNode; initiallyOpen?: boolean; warning?: (section: Omit<Section, 'raw'>) => string }) {
  return <div className="sections">{sections.map(section => (
    <details className="section" open={initiallyOpen} key={section.id}>
      <summary>
        <span className="section-name">Section {section.number}<small>Index <span className="index">{section.index}</span></small></span>
        <span className="section-instructor">{section.honors && <strong className="honors-label">{section.honors.kind === 'designated' ? 'Honors section' : 'Honors program information'} · </strong>}{section.instructors.join(', ') || 'Instructor not listed'}</span>
        <span className={`badge ${section.availability}`}>{section.availability === 'unknown' ? 'Status unknown' : `${section.availability} in snapshot`}</span>
        <span className="expand" aria-hidden="true">+</span>
        {warning && <SectionWarning text={warning(section)} />}
      </summary>
      <div className="section-body">
        <p className="muted"><strong>Delivery format: </strong>{section.delivery.label}</p>
        {section.honors && <p className="muted">{section.honors.evidence} Honors enrollment requirements must be confirmed with Rutgers.</p>}
        <p className="muted">{section.campuses.join(' · ') || 'Campus not specified'} · Registration index: <strong className="index">{section.index}</strong></p>
        {section.meetings.length === 0 && <p className="muted">No meeting times supplied — verify with Rutgers.</p>}
        <ul className="meetings">{section.meetings.map((meeting, i) => <li key={i}>
          <div><strong>{meeting.timing === 'asynchronous' ? 'Asynchronous content' : meeting.timing === 'arranged' ? 'Hours by arrangement' : day(meeting.dayCode)}</strong>
            <span>{meeting.timing === 'asynchronous' ? 'No required weekly meeting time'
              : meeting.timing === 'arranged' ? 'Coordinate meetings with the instructor after registration'
              : meeting.timing === 'unknown' ? 'Timing incomplete — verify with Rutgers'
              : `${time(meeting.startMinute)}–${time(meeting.endMinute)}`}</span></div>
          <div className="muted"><span>{meeting.mode || 'Meeting type not specified'}</span>
            <span>{[meeting.campus, meeting.building, meeting.room].filter(Boolean).join(' · ') || 'Location not specified'}</span></div>
        </li>)}</ul>
        
        {section.notices.length > 0 ? <div className="source-notes">
          <h3>Registration & source notes</h3>
          <p className="muted">Source information, not an eligibility decision. Verify requirements with Rutgers.</p>
          <dl>{section.notices.map((notice, i) => <div key={i}><dt>{fieldLabel(notice.field)}</dt><dd>{notice.text}</dd></div>)}</dl>
        </div> : <p className="muted">No restriction notes were supplied for this section. This does not establish registration eligibility.</p>}
        {renderAction?.(section)}
      </div>
    </details>
  ))}</div>;
}
