import { RegistrationReadiness, ReadinessFindings } from './registration-readiness';
import type { StudentProfile } from '@/lib/eligibility/types';
import { useState } from 'react';
import { SectionList } from '@/components/catalog/section-list';
import { formatTime } from '@/lib/scheduling/meetings';
import type { GenerationResult, RankedSchedule } from '@/lib/scheduling/generation-types';
import { WeeklyCalendar } from './weekly-calendar';

function Metrics({ schedule }: { schedule: RankedSchedule }) {
  const m = schedule.metrics;
  return <dl className="generation-metrics"><div><dt>Class days</dt><dd>{m.classDays}</dd></div><div><dt>Earliest class</dt><dd>{m.earliestStart === null ? 'No timed meetings' : formatTime(m.earliestStart)}</dd></div>
    <div><dt>Time between classes</dt><dd>{m.gapMinutes} minutes</dd></div><div><dt>Campus changes · count</dt><dd>{m.campusTransitions}</dd></div>
    <div><dt>Days on campus</dt><dd>{m.commuteDays}</dd></div></dl>;
}
// Ranked alternatives compose the existing calendar and section details, without changing the manual draft.
export function GenerationResults({ result, stale, onApply, canApply, profile, loadingMore, canExplore, onExplore }: {
  profile: StudentProfile; result: GenerationResult; stale: boolean; onApply: (schedule: RankedSchedule) => void; canApply: boolean; loadingMore: boolean; canExplore: boolean; onExplore: () => void;
}) {
  const [index, setIndex] = useState(0), [compared, setCompared] = useState<number | null>(null);
  const schedule = result.schedules[index];
  return <section className="generation-results" aria-label="Generated schedules">
    {result.truncated && <p role="status" className="snapshot-note">Search limit reached. Ranking covers the options found so far. A better schedule may exist.</p>}
    {stale && <p role="status" className="snapshot-note">Your choices, preferences, academic information, locks, or manual schedule changed. Generate again before applying.</p>}
    {!!result.issues.length && <ul className="generation-notes">{result.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    {!schedule && <p className="muted">No schedule was found in this search. Review the reasons above, then adjust a hard constraint, unlock a section if appropriate, or change your course choices and generate again.</p>}
    {schedule && <>
      <nav className="generation-navigation" aria-label="Generated schedule navigation">
        <button className="button schedule-nav-button" disabled={index === 0} onClick={() => setIndex(index - 1)}>← Previous schedule</button>
        <strong aria-live="polite">Schedule {index + 1} of {result.schedules.length}</strong>
        <button className="button schedule-nav-button" disabled={index === result.schedules.length - 1} onClick={() => setIndex(index + 1)}>Next schedule →</button>
      </nav>
      {loadingMore && <span role="status" className="sr-only">Loading more schedules.</span>}
      {result.discovery?.nextCursor
        ? <button className="text-button" disabled={stale || !canExplore} onClick={onExplore}>{loadingMore ? 'Loading more schedules…' : 'Explore more schedules'}</button>
        : <p className="muted">{result.discovery && result.discovery.uniqueValid > result.discovery.retained
          ? 'Browsing limit reached. Adjust your preferences to see a different set.'
          : result.truncated ? 'You’ve loaded every option found within the search limit.' : 'All schedules found are loaded.'}</p>}
      <WeeklyCalendar selections={schedule.selections} idPrefix="generated" />
      <Metrics schedule={schedule} />
      {schedule.selections.map(selection => <article id={`generated-${selection.section.index}`} key={selection.section.id}>
        <h4>{selection.course.code} · {selection.course.title}</h4>
        <p className="muted">Section {selection.section.number} · {selection.section.instructors.join(', ') || 'Instructor not listed'}{selection.section.availability !== 'open' && ` · Seats ${selection.section.availability} in snapshot`}</p>
        <details><summary>Section details and registration notes</summary><SectionList sections={[selection.section]} /></details>
      </article>)}
      {!!schedule.omittedCourses.length && <p>Optional courses omitted: {schedule.omittedCourses.join(', ')}.</p>}
      <RegistrationReadiness selections={schedule.selections} profile={profile} />
      <div className="generation-actions"><button className="text-button" onClick={() => setCompared(index)}>Pin this schedule for comparison</button>
        <button className="button" disabled={stale || !canApply} onClick={() => onApply(schedule)}>Apply this schedule</button></div>
      {compared !== null && <div className="schedule-comparison"><h4>Compare with schedule {compared + 1}</h4>
        <table><thead><tr><th>Metric</th><th>Pinned #{compared + 1}</th><th>Current #{index + 1}</th></tr></thead><tbody>
          <tr><th>Optional courses</th><td>{result.schedules[compared].optionalIncluded}</td><td>{schedule.optionalIncluded}</td></tr>
          {(['classDays', 'gapMinutes', 'campusTransitions', 'commuteDays'] as const).map((key, i) => <tr key={key}><th>{['Class days', 'Gaps (minutes)', 'Campus transitions', 'Days on campus'][i]}</th><td>{result.schedules[compared].metrics[key]}</td><td>{schedule.metrics[key]}</td></tr>)}
          <tr><th>Earliest class</th><td>{formatTime(result.schedules[compared].metrics.earliestStart)}</td><td>{formatTime(schedule.metrics.earliestStart)}</td></tr>
        </tbody></table>
        <p className="muted">Changed registration indexes: {schedule.selections.filter(s => !result.schedules[compared].selections.some(p => p.section.id === s.section.id)).map(s => `${s.course.code}: ${s.section.index}`).join(', ') || 'None added or replaced'}.</p>
        <p className="muted">Indexes removed from the pinned alternative: {result.schedules[compared].selections.filter(s => !schedule.selections.some(p => p.section.id === s.section.id)).map(s => `${s.course.code}: ${s.section.index}`).join(', ') || 'None'}.</p>
        <button className="text-button" onClick={() => setCompared(null)}>Clear comparison</button>
      </div>}
      <p className="muted">Applying saves this plan in your browser. Seats shown are from the Rutgers snapshot.</p>
      <details className="generation-limitations"><summary>Registration review & limitations</summary><ul className="generation-notes">{schedule.limitations.map(text => <li key={text}>{text}</li>)}</ul></details>
      <details><summary>Course prerequisites and source registration notes</summary><dl>{schedule.restrictions.map((notice, i) => <div key={i}><dt>{notice.courseCode} · index {notice.sectionIndex} · {notice.field}</dt><dd>{notice.text}</dd></div>)}</dl></details>
      <details><summary>How schedules were ranked & search details</summary>
      <p>Preference score: {schedule.score}. Includes {schedule.optionalIncluded} optional courses. Optional-course coverage ranks first, then weighted preferences; ties use registration IDs.</p>
      <details><summary>Why this score?</summary><ul className="generation-notes">{schedule.breakdown.map(part => <li key={part.label}>{part.label}: {part.amount} penalty points</li>)}</ul>
        <p className="muted">Days and hours are weighted using the controls above. Daily start times are averaged across class days. Eligibility, honors status, and snapshot seats never change this score.</p></details>
      </details>
    </>}
    <details><summary>Search counts, candidate sections and exclusions</summary>
      {result.discovery && <p className="muted">{BigInt(result.discovery.upperBound).toLocaleString('en-US')} possible combinations before conflict and cross-list checks (upper bound) · {result.discovery.evaluated.toLocaleString()} complete combinations checked · {result.discovery.uniqueValid.toLocaleString()} unique valid timetables found · {result.schedules.length} loaded of {result.discovery.retained} retained.</p>}
      <p className="muted">{result.visited.toLocaleString()} search steps. {result.truncated ? 'Stopped at the search limit.' : result.visited ? 'Search exhausted.' : 'Stopped before searching.'}</p>
{result.reports.map(report => <p className="muted" key={report.courseId}>
      {report.code}: {report.candidates} of {report.total} sections available to the solver.
      {Object.entries(report.exclusions).map(([reason, count]) => ` ${reason}: ${count}.`).join('')}
    </p>)}{result.reports.map(report => !!report.eligibilityExclusions?.length && <details key={report.courseId}><summary>{report.code}: excluded eligibility mismatches (up to 20 shown)</summary>{report.eligibilityExclusions.map(item => <div key={item.index}><h4>Index {item.index}</h4><ReadinessFindings findings={item.findings} /></div>)}</details>)}    </details>
  </section>;
}
