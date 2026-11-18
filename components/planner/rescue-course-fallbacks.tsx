import { useEffect, useRef, useState } from 'react';
import { courseProgress, degreeCourseMatches, degreeDependents, rescueDegreeProgram, ruleCourses } from '@/lib/academic/course-matches';
import type { AcademicPlanningProfile } from '@/lib/academic/profile';
import { csAdvising, csTransition, introTransition } from '@/lib/academic/rutgers-cs';
import { evaluatePreflight, timetableIssues } from '@/lib/eligibility/preflight';
import { eligibilityPriority, sourceLinks, type StudentProfile } from '@/lib/eligibility/types';
import type { CourseFallbackResult } from '@/lib/recovery/course-fallback';
import { draftSignature, protectedSections } from '@/lib/recovery/state';
import type { RescueDraft, RescueRequest } from '@/lib/recovery/types';
import { excludedIndexIds, type Selection } from '@/lib/scheduling/selection';
import { WeeklyCalendar } from './weekly-calendar';
import { RegistrationIndex } from './registration-index';

export function RescueCourseFallbacks({ sourceId, draft, target, academic, profile, request, excludedIndexes, ready, active, preparedMode = false, prepared, onApply, onPlanLater, onMoreRepairs }: {
  sourceId: string; draft: RescueDraft; target: Selection; academic: AcademicPlanningProfile; profile: StudentProfile;
  request: RescueRequest; excludedIndexes: string; ready: boolean; active: boolean; preparedMode?: boolean; prepared?: CourseFallbackResult | null;
  onApply: (targetId: string, replacement: Selection, basis: string) => boolean; onPlanLater: (code: string) => void; onMoreRepairs: () => void;
}) {
  const [response, setResponse] = useState<{ key: string; value?: CourseFallbackResult; error?: string } | null>(null);
  const [review, setReview] = useState<{ key: string; selection: Selection; approved: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const previewHeading = useRef<HTMLHeadingElement>(null);

  const { section, course } = target;
  const program = rescueDegreeProgram(academic, sourceId);
  const protectedIds = protectedSections(draft);
  const protectedTarget = protectedIds.includes(section.id);
  const kept = draft.selections.filter(s => s.section.id !== section.id);
  const matches = program ? degreeCourseMatches(program, academic, kept.map(s => s.course.code), course.code) : [];
  const dependents = program ? degreeDependents(program, course.code, academic) : [];
  const payload = JSON.stringify({ ...request, sourceId, replaceSectionIds: [], overrideProtectionIds: [],
    courseFallback: { targetId: section.id, candidateCodes: matches.map(match => match.code) } });
  const requestKey = JSON.stringify([retry, payload, draftSignature(draft), academic, excludedIndexes]);
  const canSearch = ready && !protectedTarget && draft.selections.length <= 12;
  const stale = !!response?.value && response.key !== requestKey;
  const current = canSearch && response?.key === requestKey ? response : null;
  const result = preparedMode ? prepared : current?.value;
  const preview = review?.key === requestKey ? review.selection : null;
  const alternatives = matches.flatMap(match => {
    const sections = result?.options.filter(option => option.selection.course.code === match.code) ?? [];
    const following = program ? degreeDependents(program, match.code, academic) : [];
    const mayNeedTarget = dependents.some(edge => edge.courseCode === match.code);
    return sections.length ? [{ match, sections, following, mayNeedTarget }] : [];
  }).sort((a, b) => Number(a.match.group === 'elective') - Number(b.match.group === 'elective') ||
    eligibilityPriority.indexOf(b.sections[0].eligibility) - eligibilityPriority.indexOf(a.sections[0].eligibility) ||
    Number(a.mayNeedTarget) - Number(b.mayNeedTarget) ||
    b.following.length - a.following.length || a.sections[0].score - b.sections[0].score || a.match.code.localeCompare(b.match.code)).slice(0, 4);
  const sameCourse = result?.options.filter(option => option.selection.course.code === course.code) ?? [];
  const travelWarning = result && kept.some(item => timetableIssues(item, kept).some(issue => issue.level === 'action'));
  const previewSelections = preview ? [...kept, preview] : [];

  useEffect(() => {
    if (preparedMode || !active || !canSearch || current) return;
    const controller = new AbortController();
    async function search(): Promise<void> {
      try {
        const input: RescueRequest = JSON.parse(payload);
        input.settings.constraints.excludedSectionIds = excludedIndexIds(excludedIndexes, sourceId);
        const answer = await fetch('/api/planner/rescue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify(input) });
        const value = await answer.json();
        if (!answer.ok) throw new Error(value.error || 'Could not check alternatives.');
        if (!controller.signal.aborted) setResponse({ value, key: requestKey });
      } catch (problem) {
        if (!controller.signal.aborted) setResponse({ key: requestKey, error: problem instanceof Error ? problem.message : 'Could not check alternatives.' });
      }
    }
    void search();
    return () => controller.abort();
  }, [active, canSearch, current, excludedIndexes, payload, preparedMode, requestKey, sourceId]);

  const options = (entries: CourseFallbackResult['options']) => <ul className="generation-notes">{entries.map(({ selection, needsComponentReview }) => {
    const { section: option } = selection;
    const warnings = evaluatePreflight([selection], profile, academic)[0].issues.filter(issue => issue.scope !== 'seats');
    return <li key={option.id}>
      <button className="text-button" aria-label={`Review section ${option.number} · index ${option.index}`} aria-pressed={preview?.section.id === option.id} onClick={() => {
        setReview({ key: requestKey, selection, approved: false });
        requestAnimationFrame(() => previewHeading.current?.focus());
      }}>Review section {option.number}</button>{' · '}<RegistrationIndex index={option.index} />
      {' · '}{option.availability === 'open' ? 'Open in snapshot' : 'No snapshot seat status'}
      {needsComponentReview && <p>Verify linked sections or concurrent enrollment with Rutgers.</p>}
      {!!warnings.length && <details><summary>{[...new Set(warnings.map(issue => issue.title))].join(' · ')}</summary>
        {warnings.map((issue, index) => <p key={index}>{issue.detail} <strong>Next step.</strong> {issue.next} {issue.url && <a className="back-link" href={issue.url}>Rutgers guidance ↗</a>}</p>)}
        {selection.course.prerequisites && <p>Rutgers lists {selection.course.prerequisites}</p>}
      </details>}
    </li>;
  })}</ul>;

  return <section className="rescue-results" aria-label="Section and course alternatives">
    {protectedTarget ? <div className="schedule-status"><p>This section is registered or locked. Rescue keeps it protected unless you explicitly authorize and approve a change.</p>
      <button className="text-button" onClick={onMoreRepairs}>Review protected repair options</button></div>
      : !ready ? <p>Resolve missing sections or earlier registration reports in My Schedule before searching.</p>
      : draft.selections.length > 12 ? <p>Rescue can compare up to 12 selected sections. Review your saved sections first.</p> : null}
    {!preparedMode && canSearch && !current && <p role="status">{stale ? 'The plan or academic information changed. Checking fresh alternatives…' : 'Checking alternatives around your other classes…'} Your schedule is unchanged.</p>}
    {current?.error && <div role="alert"><p>{current.error} Your schedule is unchanged.</p>
      <button className="text-button" onClick={() => setRetry(attempt => attempt + 1)}>Retry alternatives</button></div>}
    {result && <>
      <h3>Replacement options</h3>
      <p>Every other selected section stays in place, including {kept.filter(s => protectedIds.includes(s.section.id)).length} protected sections. Current seats are unverified. Check <a className="back-link" href={sourceLinks.soc}>Rutgers Schedule of Classes</a> and verify registration in WebReg.</p>
      {result.issue && <p role="status">{result.issue}</p>}
      {preparedMode && draft.selections.some(item => item !== target && draft.statuses[item.section.id] === 'failed') && <p>Other failed sections stay in this preview and still need attention.</p>}
      {travelWarning && <p className="snapshot-note">Some of your kept classes already have a short campus gap under the Rutgers travel rule. Check that gap before registering.</p>}
      {!!sameCourse.length && <><h4>Other sections of {course.code}</h4>
        {course.prerequisites && <p>Course prerequisites still apply when you switch sections.</p>}{options(sameCourse)}</>}
      {!sameCourse.length && !result.issue && <p>No other section of {course.code} was found with your other sections fixed. <button className="text-button" onClick={onMoreRepairs}>Review repairs that can move other sections</button>.</p>}
      {!!alternatives.length && <><h4>Courses that may advance your degree</h4><p>These match the 2026–27 catalog. Confirm that you still need the requirement in Degree Navigator or with an adviser.</p>
        {alternatives.map(({ match, sections, following, mayNeedTarget }) => <article className="preflight-section" key={match.code}>
          <h4>{sections[0].selection.course.title} ({match.code})</h4>
          <p><strong>{match.requirement.title}.</strong>{match.scienceTrack && ` Part of the ${match.scienceTrack.join(', ')} sequence.`}
            {following.length > 0 && ' A documented prerequisite route for ' + following.map(edge => edge.courseCode).join(', ') + '.'}
            {courseProgress(academic, match.code) === 'planned' && ' Already on your future course list.'}
            {' '}<a className="back-link" href={match.requirement.source.url}>Rutgers requirement ↗</a></p>
          {mayNeedTarget && <p>A published prerequisite route uses {course.code}. Confirm another route before relying on this course.</p>}
          {options(sections)}
        </article>)}
      </>}
      {program && !alternatives.length && !result.issue && <p>No other degree-relevant course was found under these constraints. Review your prerequisites or check other options with <a className="back-link" href={csAdvising}>CS advising</a>.</p>}
      {!program && <details><summary>Check another course toward your degree</summary><p>Degree-aware suggestions support New Brunswick SAS Computer Science B.A. and B.S. profiles using the 2026–27 catalog. <a className="back-link" href="#academic-planning-profile">Review your academic profile</a>.</p></details>}
      {result.truncated && <p>Search reached its work limit. More options may be available.</p>}
      {preview && <div className="schedule-status">
        <h4 tabIndex={-1} ref={previewHeading}>Review before applying</h4>
        <p>{course.code} · index {section.index} → {preview.course.code} · index {preview.section.index}. All other sections stay as selected.</p>
        <WeeklyCalendar selections={previewSelections} idPrefix={preparedMode ? 'prepared-course' : 'rescue-course'} />
        <ul className="generation-notes">{previewSelections.map(item => <li id={`${preparedMode ? 'prepared-course' : 'rescue-course'}-${item.section.index}`} key={item.section.id}>
          {item.course.code} · index {item.section.index} · {item === preview ? 'Proposed' : 'Preserved'}
        </li>)}</ul>
        <label className="academic-checkbox"><input type="checkbox" checked={!!review?.approved} onChange={event => setReview({ key: requestKey, selection: preview, approved: event.target.checked })} />I approve this planner change and will verify requirements and seats with Rutgers.</label>
        <button className="button" disabled={!review?.approved || !canSearch} onClick={() => {
          if (onApply(section.id, preview, result.basis)) setReview(null);
        }}>Apply approved replacement</button>
      </div>}
    </>}
    <details><summary>Plan {course.code} for a later term</summary>
      {!!dependents.length && <ul className="generation-notes">{dependents.map(edge => <li key={edge.courseCode}>
        Postponing {course.code} could delay {edge.courseCode}. A documented route uses {ruleCourses(edge.prerequisite).join(', ')}. <a className="back-link" href={edge.source.url}>Rutgers prerequisite ↗</a>
      </li>)}</ul>}
      {introTransition.includes(course.code) && <p>CS111/112 and CS121/122 follow different transition rules. Confirm your path before planning a later term. <a className="back-link" href={csTransition.url}>Rutgers transition guidance ↗</a></p>}
      <p>Check a later term in the Schedule of Classes when it is published. A later offering for your case has yet to be verified here.</p>
      <button className="text-button" onClick={() => onPlanLater(course.code)}>Add {course.code} to planned future courses</button>
    </details>
  </section>;
}
