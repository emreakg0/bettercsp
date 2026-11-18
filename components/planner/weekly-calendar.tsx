import type { Meeting } from '@/lib/catalog/types';
import type { CSSProperties } from 'react';
import { calendarCampus, calendarCampuses } from '@/lib/catalog/calendar-campus';
import { formatDay, formatTime, isScheduled, weekDays } from '@/lib/scheduling/meetings';
import type { Selection } from '@/lib/scheduling/selection';

// No calendar primitive exists; this view positions every normalized meeting independently.
export function WeeklyCalendar({ selections, idPrefix = 'selected', fit = false, onInspect }: { selections: Selection[]; idPrefix?: string; fit?: boolean; onInspect?: (selection: Selection, meeting: Meeting) => void }) {
  const events = selections.flatMap(item => item.section.meetings.flatMap((meeting, i) =>
    isScheduled(meeting) ? [{ ...item, meeting, campus: calendarCampus(meeting.campus), key: `${item.section.id}:${i}` }] : []));
  const start = Math.min((onInspect ? 7 : 8) * 60, ...events.map(e => Math.floor(e.meeting.startMinute / 60) * 60));
  const end = Math.max((onInspect ? 23 : 20) * 60, ...events.map(e => Math.ceil(e.meeting.endMinute / 60) * 60));
  const hours = Array.from({ length: (end - start) / 60 + 1 }, (_, i) => start + i * 60);
  const percent = (minutes: number) => `${100 * minutes / (end - start)}%`;
  const axis = fit ? 'var(--fit-axis)' : end - start;
  const Event = onInspect ? 'button' : 'a';
  return <>{!events.length && <p className="schedule-status">{selections.length
    ? 'No timed meetings to display. Review section details for asynchronous coursework, arranged meetings, or times that need verification.'
    : 'Your calendar is empty. Add a section from course search or apply a generated schedule to see your week.'}</p>}
    <div className={fit ? "calendar-scroll calendar-fit" : "calendar-scroll"} tabIndex={0} role="region" aria-label="Weekly calendar, scroll horizontally for all seven days">
    <div className="week-calendar">
      <div className="calendar-label">ET</div>{weekDays.map(day => <div className="calendar-label" key={day}>{formatDay(day)}</div>)}
      <div className="hour-axis" style={{ height: axis }}>{hours.map(hour =>
        <span key={hour} style={{ top: percent(hour - start) }}>{formatTime(hour)}</span>)}</div>
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
        return <div className="calendar-day" key={day} style={{ height: axis, "--hour-step": percent(60) } as CSSProperties}>
          {groups.flatMap(group => {
            const laneEnds: number[] = [];
            const placed = group.map(event => {
              let lane = laneEnds.findIndex(end => end <= event.meeting.startMinute);
              if (lane < 0) lane = laneEnds.length;
              laneEnds[lane] = event.meeting.endMinute;
              return { event, lane };
            });
            return placed.map(({ event, lane }) => {
              const campus = event.campus === 'other' ? event.meeting.campus || 'Campus unknown' : calendarCampuses[event.campus];
              const startTime = formatTime(event.meeting.startMinute);
              const endTime = formatTime(event.meeting.endMinute);
              const timeRange = `${startTime.slice(-2) === endTime.slice(-2) ? startTime.slice(0, -3) : startTime}–${endTime}`;
              const instructors = event.section.instructors.map(name => name.trim()).filter(name =>
                name && !/^(?:staff|t\.?b\.?[ad]\.?|to be (?:announced|assigned|determined)|unassigned|unknown|n\/a|not (?:assigned|listed)|arranged)$/i.test(name));
              const closed = event.section.availability === 'closed';
              return <Event key={event.key} href={onInspect ? undefined : `#${idPrefix}-${event.section.index}`}
                onClick={onInspect ? () => onInspect(event, event.meeting) : undefined} type={onInspect ? 'button' : undefined}
                aria-label={`${event.course.title}, section ${event.section.number}, ${formatDay(day)} ${startTime} to ${endTime}, ${campus}${event.meeting.mode ? ', ' + event.meeting.mode : ''}${closed ? ', closed in snapshot' : ''}`}
                className="calendar-event" data-campus={event.campus} data-closed={closed || undefined} style={{ top: percent(event.meeting.startMinute - start),
                  height: percent(event.meeting.endMinute - event.meeting.startMinute), left: `${lane * 100 / laneEnds.length}%`, width: `${100 / laneEnds.length}%` }}>
                <strong>{event.course.title}</strong>
                <span className="calendar-event-meeting"><span>{timeRange}</span><span>{campus}</span></span>
                {!!instructors.length && <span className="calendar-event-instructor">
                  <span>{instructors[0]}</span>{instructors.length > 1 && <span> +{instructors.length - 1}</span>}
                </span>}
              </Event>;
            });
          })}
        </div>;
      })}
    </div>
  </div>
    {!!events.length && <ul className="calendar-legend" aria-label="Calendar campus and availability legend">
      {Object.entries(calendarCampuses).map(([campus, label]) => <li key={campus}>
        <span className="calendar-swatch" data-campus={campus} aria-hidden="true" />{label}
      </li>)}
      <li><span className="calendar-swatch" data-closed="true" aria-hidden="true" />Closed in snapshot · verify current availability</li>
    </ul>}
  </>;
}
