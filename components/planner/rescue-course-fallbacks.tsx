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

export function RescueCourseFallbacks({ sourceId, draft, target, academic, profile, request, excludedIndexes, ready, onApply, onPlanLater }: {
  sourceId: string; draft: RescueDraft; target: Selection; academic: AcademicPlanningProfile; profile: StudentProfile;
  request: RescueRequest; excludedIndexes: string; ready: boolean;
  onApply: (targetId: string, replacement: Selection, basis: string) => boolean; onPlanLater: (code: string) => void;
}) {
  const [response, setResponse] = useState<{ value: CourseFallbackResult; context: string } | null>(null);
  const [preview, setPreview] = useState<Selection | null>(null);
  const [approved, setApproved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => active.current?.abort(), []);

  const { section, course } = target;
  const program = rescueDegreeProgram(academic, sourceId);
  const protectedIds = protectedSections(draft);
  const protectedTarget = protectedIds.includes(section.id);
  const kept = draft.selections.filter(s => s.section.id !== section.id);
  const matches = program ? degreeCourseMatches(program, academic, kept.map(s => s.course.code), course.code) : [];
  const dependents = program ? degreeDependents(program, course.code, academic) : [];
  const context = JSON.stringify([sourceId, draftSignature(draft), section.id, academic, request.settings, excludedIndexes]);
  const stale = !!response && response.context !== context;
  const result = stale ? null : response?.value;
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

  async function search(): Promise<void> {
    if (active.current || !ready || !program || protectedTarget) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError('');
    setResponse(null);
    setPreview(null);
    setApproved(false);
    try {
      const answer = await fetch('/api/planner/rescue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ ...request, sourceId, replaceSectionIds: [], overrideProtectionIds: [],
          settings: { ...request.settings, constraints: { ...request.settings.constraints, excludedSectionIds: excludedIndexIds(excludedIndexes, sourceId) } },
          courseFallback: { targetId: section.id, candidateCodes: matches.map(match => match.code) } }),
      });
      const value = await answer.json();
      if (!answer.ok) throw new Error(value.error || 'Could not check course alternatives.');
      if (!controller.signal.aborted) setResponse({ value, context });
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'Could not check course alternatives.');
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const options = (entries: CourseFallbackResult['options']) => <ul className="generation-notes">{entries.map(({ selection, needsComponentReview }) => {
    const { section: option } = selection;
    const warnings = evaluatePreflight([selection], profile, academic)[0].issues.filter(issue => issue.scope !== 'seats');
    return <li key={option.id}>
      <button className="text-button" aria-pressed={preview?.section.id === option.id} onClick={() => {
        setPreview(selection); setApproved(false);
        requestAnimationFrame(() => previewHeading.current?.focus());
      }}>Review section {option.number} · index {option.index}</button>
      {' · '}{option.availability === 'open' ? 'Open in snapshot' : 'No snapshot seat status'}
      {needsComponentReview && <p>Verify linked sections or concurrent enrollment with Rutgers.</p>}
      {!!warnings.length && <details><summary>{[...new Set(warnings.map(issue => issue.title))].join(' · ')}</summary>
        {warnings.map((issue, index) => <p key={index}>{issue.detail} <strong>Next step.</strong> {issue.next} {issue.url && <a className="back-link" href={issue.url}>Rutgers guidance ↗</a>}</p>)}
        {selection.course.prerequisites && <p>Rutgers lists {selection.course.prerequisites}</p>}
      </details>}
    </li>;
  })}</ul>;

  return <section className="rescue-results" aria-label="Degree-aware Rescue">
    {program ? <button className="text-button" disabled={!ready || pending || protectedTarget || draft.selections.length > 12} onClick={() => void search()}>
      {pending ? 'Checking course alternatives…' : 'Find another course that advances my degree'}
    </button> : <p className="muted">Degree-aware suggestions are available for New Brunswick SAS Computer Science B.A. and B.S. profiles using the 2026–27 catalog. <a className="back-link" href="#academic-planning-profile">Review your program profile</a>.</p>}
    {program && protectedTarget && <p className="muted">Verify this registered or locked section before considering a different course.</p>}
    {error && <p role="alert">{error} You can retry without changing your schedule.</p>}
    {stale && <p role="status">Your schedule, profile, or preferences changed. Search again before applying an alternative.</p>}
    {result && <>
      <h3>Options around your existing classes</h3>
      <p>Every other selected section stays in place, including {kept.filter(s => protectedIds.includes(s.section.id)).length} protected sections. Confirm current seats in <a className="back-link" href={sourceLinks.soc}>Rutgers Schedule of Classes</a> and verify registration in WebReg.</p>
      {result.issue && <p role="status">{result.issue}</p>}
      {travelWarning && <p className="snapshot-note">Some of your kept classes already have a short campus gap under the Rutgers travel rule. Check that gap before registering.</p>}
      {!!sameCourse.length && <><h4>Try another section of {course.code} first</h4>
        {course.prerequisites && <p>Course prerequisites still apply when you switch sections.</p>}{options(sameCourse)}</>}
      {!sameCourse.length && !result.issue && <p>No other section of {course.code} was found with all your other selections fixed. The usual Rescue search can also check small changes to unlocked sections.</p>}
      {!!alternatives.length && <><h4>Different courses to consider</h4><p>Each match is based on the 2026–27 catalog. Confirm that you still need the requirement in Degree Navigator or with an adviser.</p>
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
      {!alternatives.length && !result.issue && <p>No supported different course was found within these constraints. Review your prerequisite facts or check other options with <a className="back-link" href={csAdvising}>CS advising</a>.</p>}
      {result.truncated && <p>Search reached its work limit. More options may be available.</p>}
      {preview && <div className="schedule-status">
        <h4 tabIndex={-1} ref={previewHeading}>Review before applying</h4>
        <p>{course.code} · index {section.index} → {preview.course.code} · index {preview.section.index}. All other sections stay as selected.</p>
        <WeeklyCalendar selections={previewSelections} idPrefix="rescue-course" />
        <ul className="generation-notes">{previewSelections.map(item => <li id={`rescue-course-${item.section.index}`} key={item.section.id}>
          {item.course.code} · index {item.section.index} · {item === preview ? 'Proposed' : 'Preserved'}
        </li>)}</ul>
        <label className="academic-checkbox"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />I approve this planner change and will verify degree applicability, requirements, and seats with Rutgers.</label>
        <button className="button" disabled={!approved || !ready || protectedTarget} onClick={() => {
          if (onApply(section.id, preview, result.basis)) { setPreview(null); setApproved(false); }
        }}>Apply approved course alternative</button>
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
