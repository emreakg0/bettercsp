import { useState } from 'react';
import { SectionList } from '@/components/catalog/section-list';
import { formatTime } from '@/lib/scheduling/meetings';
import type { GenerationResult, RankedSchedule } from '@/lib/scheduling/generation-types';
import { WeeklyCalendar } from './weekly-calendar';

function Metrics({ schedule }: { schedule: RankedSchedule }) {
  const m = schedule.metrics;
  return <dl className="generation-metrics"><div><dt>Preference penalty · lower is better</dt><dd>{schedule.score}</dd></div>
    <div><dt>Class days</dt><dd>{m.classDays}</dd></div><div><dt>Earliest class</dt><dd>{m.earliestStart === null ? 'No timed meetings' : formatTime(m.earliestStart)}</dd></div>
    <div><dt>Scheduled gaps</dt><dd>{m.gapMinutes} minutes</dd></div><div><dt>Campus transitions · proxy</dt><dd>{m.campusTransitions}</dd></div>
    <div><dt>Days on campus</dt><dd>{m.commuteDays}</dd></div></dl>;
}
// Ranked alternatives compose the existing calendar and section details, without changing the manual draft.
export function GenerationResults({ result, stale, onApply, canApply }: {
  result: GenerationResult; stale: boolean; onApply: (schedule: RankedSchedule) => void; canApply: boolean;
}) {
  const [index, setIndex] = useState(0), [compared, setCompared] = useState<number | null>(null);
  const schedule = result.schedules[index];
  return <section className="generation-results" aria-label="Generated schedules">
    <h3>{result.schedules.length} ranked {result.schedules.length === 1 ? 'schedule' : 'schedules'}</h3>
    <p className="muted">{result.visited.toLocaleString()} search steps · {result.completed.toLocaleString()} combinations scored. {result.truncated ? 'Search budget reached: these are the best found, not guaranteed global optima.' : 'Search completed; showing the best retained alternatives.'}</p>
    {stale && <p role="status" className="snapshot-note">Your choices, preferences, locks, or manual schedule changed. Generate again before applying.</p>}
    {!!result.issues.length && <ul className="generation-notes">{result.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    <details><summary>Candidate sections and exclusions</summary>{result.reports.map(report => <p className="muted" key={report.courseId}>
      {report.code}: {report.candidates} of {report.total} sections available to the solver.
      {Object.entries(report.exclusions).map(([reason, count]) => ` ${reason}: ${count}.`).join('')}
    </p>)}</details>
    {schedule && <>
      <nav className="generation-navigation" aria-label="Generated schedule navigation">
        <button className="text-button" disabled={index === 0} onClick={() => setIndex(index - 1)}>← Previous schedule</button>
        <span>Schedule {index + 1} of {result.schedules.length}</span>
        <button className="text-button" disabled={index === result.schedules.length - 1} onClick={() => setIndex(index + 1)}>Next schedule →</button>
      </nav>
      <p>{index === 0 ? 'Top ranked among the searched combinations' : `Alternative ${index + 1}`}: includes {schedule.optionalIncluded} optional {schedule.optionalIncluded === 1 ? 'course' : 'courses'}, then minimizes your weighted penalty. Ties use registration IDs.</p>
      <Metrics schedule={schedule} />
      <details><summary>Why this score?</summary><ul className="generation-notes">{schedule.breakdown.map(part => <li key={part.label}>{part.label}: {part.amount} penalty points</li>)}</ul>
        <p className="muted">Days and hours are weighted using the controls above. Daily start times are averaged across class days. Eligibility, honors status, and snapshot seats never change this score.</p></details>
      {!!schedule.omittedCourses.length && <p>Optional courses omitted: {schedule.omittedCourses.join(', ')}.</p>}
      <div className="generation-actions"><button className="text-button" onClick={() => setCompared(index)}>Pin this schedule for comparison</button>
        <button className="button" disabled={stale || !canApply} onClick={() => onApply(schedule)}>Apply this schedule</button></div>
      {compared !== null && <div className="schedule-comparison"><h4>Compare with schedule {compared + 1}</h4>
        <table><thead><tr><th>Metric</th><th>Pinned #{compared + 1}</th><th>Current #{index + 1}</th></tr></thead><tbody>
          <tr><th>Penalty</th><td>{result.schedules[compared].score}</td><td>{schedule.score}</td></tr>
          <tr><th>Optional courses</th><td>{result.schedules[compared].optionalIncluded}</td><td>{schedule.optionalIncluded}</td></tr>
          {(['classDays', 'gapMinutes', 'campusTransitions', 'commuteDays'] as const).map((key, i) => <tr key={key}><th>{['Class days', 'Gaps (minutes)', 'Campus transitions', 'Days on campus'][i]}</th><td>{result.schedules[compared].metrics[key]}</td><td>{schedule.metrics[key]}</td></tr>)}
          <tr><th>Earliest class</th><td>{formatTime(result.schedules[compared].metrics.earliestStart)}</td><td>{formatTime(schedule.metrics.earliestStart)}</td></tr>
        </tbody></table>
        <p className="muted">Changed registration indexes: {schedule.selections.filter(s => !result.schedules[compared].selections.some(p => p.section.id === s.section.id)).map(s => `${s.course.code}: ${s.section.index}`).join(', ') || 'None added or replaced'}.</p>
        <p className="muted">Indexes removed from the pinned alternative: {result.schedules[compared].selections.filter(s => !schedule.selections.some(p => p.section.id === s.section.id)).map(s => `${s.course.code}: ${s.section.index}`).join(', ') || 'None'}.</p>
        <button className="text-button" onClick={() => setCompared(null)}>Clear comparison</button>
      </div>}
      <p className="muted">Preview only. Apply updates the manual planner and local save. Unrelated manual selections and locked sections are preserved. Review registration notes before applying.</p>
      <WeeklyCalendar selections={schedule.selections} idPrefix="generated" />
      <details className="generation-limitations" open><summary>Registration review & limitations</summary><ul className="generation-notes">{schedule.limitations.map(text => <li key={text}>{text}</li>)}</ul></details>
      <details><summary>Course prerequisites and source registration notes</summary><dl>{schedule.restrictions.map((notice, i) => <div key={i}><dt>{notice.courseCode} · index {notice.sectionIndex} · {notice.field}</dt><dd>{notice.text}</dd></div>)}</dl></details>
      {schedule.selections.map(selection => <article id={`generated-${selection.section.index}`} key={selection.section.id}>
        <h4>{selection.course.code} · {selection.course.title}</h4><SectionList sections={[selection.section]} />
      </article>)}
    </>}
  </section>;
}
