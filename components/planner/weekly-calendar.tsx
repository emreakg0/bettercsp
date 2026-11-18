import { formatDay, formatTime, isScheduled, weekDays } from '@/lib/scheduling/meetings';
import type { Selection } from '@/lib/scheduling/selection';

// No calendar primitive exists; this view positions every normalized meeting independently.
export function WeeklyCalendar({ selections, idPrefix = 'selected' }: { selections: Selection[]; idPrefix?: string }) {
  const events = selections.flatMap(item => item.section.meetings.flatMap((meeting, i) =>
    isScheduled(meeting) ? [{ ...item, meeting, key: `${item.section.id}:${i}` }] : []));
  const start = Math.min(8 * 60, ...events.map(e => Math.floor(e.meeting.startMinute / 60) * 60));
  const end = Math.max(20 * 60, ...events.map(e => Math.ceil(e.meeting.endMinute / 60) * 60));
  const hours = Array.from({ length: (end - start) / 60 + 1 }, (_, i) => start + i * 60);
  return <>{!events.length && <p className="schedule-status">{selections.length
    ? 'No timed meetings to display. Review section details for asynchronous coursework, arranged meetings, or times that need verification.'
    : 'Your calendar is empty. Add a section from course search or apply a generated schedule to see your week.'}</p>}
    <div className="calendar-scroll" tabIndex={0} role="region" aria-label="Weekly calendar, scroll horizontally for all seven days">
    <div className="week-calendar">
      <div className="calendar-label">ET</div>{weekDays.map(day => <div className="calendar-label" key={day}>{formatDay(day)}</div>)}
      <div className="hour-axis" style={{ height: end - start }}>{hours.map(hour =>
        <span key={hour} style={{ top: hour - start }}>{formatTime(hour)}</span>)}</div>
      {weekDays.map(day => {
        const daily = events.filter(e => e.meeting.dayCode === day)
          .sort((a, b) => a.meeting.startMinute - b.meeting.startMinute || a.key.localeCompare(b.key));
        // Give overlapping blocks distinct lanes, including chains of overlapping meetings.
        const groups: typeof daily[] = [];
        let groupEnd = -1;
        for (const event of daily) {
          if (event.meeting.startMinute >= groupEnd) { groups.push([]); groupEnd = -1; }
          groups[groups.length - 1].push(event);
          groupEnd = Math.max(groupEnd, event.meeting.endMinute);
        }
        return <div className="calendar-day" key={day} style={{ height: end - start }}>
          {groups.flatMap(group => {
            const laneEnds: number[] = [];
            const placed = group.map(event => {
              let lane = laneEnds.findIndex(end => end <= event.meeting.startMinute);
              if (lane < 0) lane = laneEnds.length;
              laneEnds[lane] = event.meeting.endMinute;
              return { event, lane };
            });
            return placed.map(({ event, lane }) => <a key={event.key} href={`#${idPrefix}-${event.section.index}`}
              className="calendar-event" style={{ top: event.meeting.startMinute - start,
                height: event.meeting.endMinute - event.meeting.startMinute, left: `${lane * 100 / laneEnds.length}%`, width: `${100 / laneEnds.length}%` }}>
              <strong>{event.course.code}</strong><span>{event.meeting.mode || 'Meeting'} · {event.section.number}</span>
              <span>{formatTime(event.meeting.startMinute)}–{formatTime(event.meeting.endMinute)}</span>
              <span>{[event.meeting.campus, event.meeting.building, event.meeting.room].filter(Boolean).join(' · ') || 'Location unspecified'}</span>
            </a>);
          })}
        </div>;
      })}
    </div>
  </div></>;
}
