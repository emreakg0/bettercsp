import { ReadinessFindings } from './registration-readiness';
import type { StudentProfile } from '@/lib/eligibility/types';
import { useState } from 'react';
import { SectionList } from '@/components/catalog/section-list';
import { formatTime } from '@/lib/scheduling/meetings';
import { RegistrationPreflight } from './registration-preflight';
import type { PlanningContext } from '@/lib/eligibility/preflight';
import type { GenerationResult, HardConstraints, RankedSchedule } from '@/lib/scheduling/generation-types';
import { WeeklyCalendar } from './weekly-calendar';

function Metrics({ schedule }: { schedule: RankedSchedule }) {
  const m = schedule.metrics;
  return <dl className="generation-metrics"><div><dt>Class days</dt><dd>{m.classDays}</dd></div><div><dt>Earliest class</dt><dd>{m.earliestStart === null ? 'No timed meetings' : formatTime(m.earliestStart)}</dd></div>
    <div><dt>Time between classes</dt><dd>{m.gapMinutes} minutes</dd></div><div><dt>Campus changes · count</dt><dd>{m.campusTransitions}</dd></div>
    <div><dt>Days on campus</dt><dd>{m.commuteDays}</dd></div></dl>;
}
// Ranked alternatives compose the existing calendar and section details, without changing the manual draft.
export function GenerationResults({ result, stale, onApply, onSave, canApply, profile, planning, preflightConstraints, protectedIds, loadingMore, canExplore, pageError, onExplore, emptyBatch, allFixed, onTryOtherSections, onReviewSchedule }: {
  planning: PlanningContext; preflightConstraints: HardConstraints | null; protectedIds: string[];
  profile: StudentProfile; result: GenerationResult; stale: boolean; onApply: (schedule: RankedSchedule, rescueSectionId?: string) => void; canApply: boolean; loadingMore: boolean; canExplore: boolean; onExplore: () => void; pageError: { message: string; restart: boolean } | null;
  onSave: (schedule: RankedSchedule) => void;
  emptyBatch: boolean; allFixed: boolean; onTryOtherSections?: () => void; onReviewSchedule: () => void;
}) {
  const [requestedIndex, setIndex] = useState(0), [compared, setCompared] = useState<number | null>(null);
  const index = Math.max(0, Math.min(requestedIndex, result.schedules.length - 1));
  const schedule = result.schedules[index];
  const progress = result.discovery;
  const hasMore = !!progress?.nextCursor && !stale && !pageError?.restart;
  const atEnd = index >= result.schedules.length - 1;
  const onlyOne = progress?.exhausted && progress.uniqueValid === 1 && !progress.nextCursor;
  function next(): void {
    if (schedule && !atEnd) {
      setIndex(index + 1);
      if (hasMore && canExplore && !pageError && !loadingMore && index + 2 >= result.schedules.length - 2) onExplore();
    } else if (hasMore && canExplore && !pageError) {
      setIndex(result.schedules.length);
      if (!loadingMore) onExplore();
    }
  }
  return <section className="generation-results" aria-label="Generated schedules">
    {!stale && result.truncated && (progress?.sessionLimited || (!progress?.resumable && !hasMore)) && <p role="status" className="snapshot-note">{progress?.sessionLimited
      ? 'This search reached its session limit. Some combinations remain unchecked.'
      : 'The search reached its work limit. Some combinations remain unchecked.'}</p>}
    {stale && <p role="status" className="snapshot-note">Your choices, preferences, academic information, locks, or manual schedule changed. Generate again before applying.</p>}
    {!!result.issues.length && <ul className="generation-notes">{result.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    {!schedule && <p className="muted">{progress?.nextCursor
      ? 'No schedules found yet. Continue searching the remaining combinations.'
      : 'No schedule was found. Review the reasons above, then adjust a constraint or change your course choices and generate again.'}</p>}
    {(schedule || hasMore) && <nav className="generation-navigation" aria-label="Generated schedule navigation">
        <button className="button schedule-nav-button" disabled={index === 0} onClick={() => setIndex(index - 1)}>← Previous schedule</button>
        <strong aria-live="polite">{schedule ? `Schedule ${index + 1} of ${result.schedules.length} loaded` : '0 schedules loaded'}</strong>
        <button className="button schedule-nav-button" disabled={atEnd && (!hasMore || !canExplore || !!pageError)} onClick={next}>Next schedule →</button>
      </nav>}
      {loadingMore && <p role="status" className="muted">Loading next schedules…</p>}
      {!stale && pageError && <div role="alert" className="muted">{pageError.message}{!pageError.restart && hasMore
        && <button className="text-button" disabled={!canExplore || loadingMore} onClick={onExplore}>Retry next batch</button>}</div>}
      {!stale && atEnd && emptyBatch && hasMore && !loadingMore && !pageError && <p role="status" className="muted">The last batch found no new schedules. Choose Next schedule to keep searching.</p>}
      {!stale && schedule && onlyOne && <div className="schedule-status">
        <strong>{allFixed ? 'Every course is fixed to a section.' : 'Only one compatible timetable matches these choices and constraints.'}</strong>
        {allFixed && <p>{onTryOtherSections ? 'Try other sections without changing My Schedule or releasing protected sections.' : 'Review registered or locked sections in My Schedule if a protection needs updating.'}</p>}
        {allFixed && (onTryOtherSections ? <button className="button" onClick={onTryOtherSections}>Try other sections</button>
          : <button className="text-button" onClick={onReviewSchedule}>Review protected sections</button>)}
      </div>}
      {!stale && !onlyOne && !progress?.nextCursor && schedule && !result.truncated && progress?.exhausted && <p className="muted">{progress.uniqueValid !== progress.retained
        ? 'Search finished. All shortlisted schedules are loaded.' : 'Search finished. All compatible schedules are loaded.'}</p>}
    {schedule && <>
      <RegistrationPreflight key={schedule.id} selections={schedule.selections} profile={profile} planning={planning}
        protectedIds={protectedIds} constraints={preflightConstraints} stale={stale}
        onRescue={canApply && !stale ? sectionId => onApply(schedule, sectionId) : undefined}
        rescueLabel="Apply this preview and open Registration Rescue" />
      <WeeklyCalendar selections={schedule.selections} idPrefix="generated" />
      <Metrics schedule={schedule} />
      {schedule.selections.map(selection => <article id={`generated-${selection.section.index}`} key={selection.section.id}>
        <h4>{selection.course.code} · {selection.course.title}</h4>
        <p className="muted">Section {selection.section.number} · {selection.section.instructors.join(', ') || 'Instructor not listed'}{selection.section.availability !== 'open' && ` · Seats ${selection.section.availability} in snapshot`}</p>
        <details><summary>Section details and registration notes</summary><SectionList sections={[selection.section]} /></details>
      </article>)}
      {!!schedule.omittedCourses.length && <p>Optional courses omitted: {schedule.omittedCourses.join(', ')}.</p>}
      <div className="generation-actions"><button className="text-button" onClick={() => setCompared(index)}>Pin this schedule for comparison</button>
        <button className="text-button" disabled={stale || !canApply} onClick={() => onSave(schedule)}>Save as new named schedule</button>
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
      <p>Preference score: {schedule.score}. Includes {schedule.optionalIncluded} optional courses. Within each search window, optional-course coverage ranks first, then weighted preferences. Ties use registration IDs. Later windows do not reorder earlier results.</p>
      <details><summary>Why this score?</summary><ul className="generation-notes">{schedule.breakdown.map(part => <li key={part.label}>{part.label}: {part.amount} penalty points</li>)}</ul>
        <p className="muted">Days and hours are weighted using the controls above. Daily start times are averaged across class days. Eligibility, honors status, and snapshot seats never change this score.</p></details>
      </details>
    </>}
    <details><summary>Search counts, candidate sections and exclusions</summary>
      {result.discovery && <p className="muted">{BigInt(result.discovery.upperBound).toLocaleString('en-US')} possible combinations before conflict and cross-list checks (upper bound) · {result.discovery.evaluated.toLocaleString()} complete combinations checked · {result.discovery.uniqueValid.toLocaleString()} unique valid timetables found · {result.schedules.length} loaded of {result.discovery.retained} retained.</p>}
      <p className="muted">{result.visited.toLocaleString()} search steps{progress?.windowSteps !== undefined && ` (${progress.windowSteps.toLocaleString()} on last request)`}. {progress?.exhausted ? 'Search exhausted.' : result.truncated ? 'Stopped at the work limit with combinations unexplored.' : 'Stopped before searching.'}</p>
{result.reports.map(report => <p className="muted" key={report.courseId}>
      {report.code}: {report.candidates} of {report.total} sections available to the solver.
      {Object.entries(report.exclusions).map(([reason, count]) => ` ${reason}: ${count}.`).join('')}
    </p>)}{result.reports.map(report => !!report.eligibilityExclusions?.length && <details key={report.courseId}><summary>{report.code}: excluded eligibility mismatches (up to 20 shown)</summary>{report.eligibilityExclusions.map(item => <div key={item.index}><h4>Index {item.index}</h4><ReadinessFindings findings={item.findings} /></div>)}</details>)}    </details>
  </section>;
}
