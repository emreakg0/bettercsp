import { useState } from 'react';
import type { StudentProfile } from '@/lib/eligibility/types';
import type { RescueDraft, RescueResult, Repair } from '@/lib/recovery/types';
import { registrationLabels } from '@/lib/recovery/types';
import { WeeklyCalendar } from './weekly-calendar';
import { RegistrationReadiness } from './registration-readiness';
import { RegistrationIndex } from './registration-index';

// Rescue proposals reuse calendar/readiness views but need explicit before/after approval controls.
export function RescueResults({ result, draft, goal, profile, stale, overrides, onApply }: {
  result: RescueResult; goal: string; draft: RescueDraft; profile: StudentProfile; stale: boolean; overrides: string[];
  onApply: (repair: Repair, basis: string, overrides: string[]) => boolean;
}) {
  const [index, setIndex] = useState(0), [approved, setApproved] = useState(false), [protectedApproval, setProtectedApproval] = useState(false);
  const [applied, setApplied] = useState(false);
  const repair = result.repairs[index];
  const blockers = repair?.schedule.eligibility.filter(finding =>
    finding.status === 'permission-required' || finding.status === 'potentially-ineligible') ?? [];
  const protectedChanges = repair?.changedIds.filter(id => draft.locks.includes(id) || draft.statuses[id] === 'registered') ?? [];
  return <section className="rescue-results" aria-label="Rescue proposals">
    <h3>{result.repairs.length ? 'Proposed repairs' : 'No repair found under these protections'}</h3>
    <p><strong>Goal:</strong> {goal}.</p>
    {!!result.issues.length && <ul className="generation-notes">{result.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    {stale && <p role="status" className="snapshot-note">Schedule, reports, protections, facts, or constraints changed. Search again before approving a repair.</p>}
    {repair && <>
      <nav className="generation-navigation" aria-label="Rescue alternatives">
        <button className="text-button" disabled={!index} onClick={() => { setIndex(index - 1); setApproved(false); setProtectedApproval(false); }}>← Previous repair</button>
        <span>Repair {index + 1} of {result.repairs.length}</span>
        <button className="text-button" disabled={index === result.repairs.length - 1} onClick={() => { setIndex(index + 1); setApproved(false); setProtectedApproval(false); }}>Next repair →</button>
      </nav>
      <p><strong>{repair.changedIds.length} {repair.changedIds.length === 1 ? 'section changes' : 'sections change'} · {repair.before.length - repair.changedIds.length} unchanged.</strong> All courses stay in the plan.</p>
      {repair.changedIds.length > 0 && <p><strong>Changes:</strong> {repair.before.filter(s => repair.changedIds.includes(s.section.id)).map(({ course, section }) => {
        const next = repair.schedule.selections.find(s => s.course.id === course.id)!;
        return course.code + ' section ' + section.number + ' → ' + next.section.number;
      }).join(', ')}.</p>}
      <p>{repair.requiresReview ? 'Before acting, confirm current seats and any remaining requirements with Rutgers.' : 'Supported checks found no known blocker. Confirm enrollment in WebReg.'}</p>
      {!!blockers.length && <ul className="generation-notes">{blockers.map(finding => {
        const selection = repair.schedule.selections.find(s => s.section.id === finding.sectionId);
        return <li key={finding.sectionId}>{selection?.course.code}: {finding.status === 'permission-required' ? 'Permission still required.' : 'Eligibility concern still needs review.'}</li>;
      })}</ul>}
      {result.truncated && <p>The search stopped early. A repair with fewer changes may still exist.</p>}
      {!repair.changedIds.length && <p className="muted">The available evidence does not establish a required section change. Verify the reported condition, or select an index for replacement and search again. This preview does not resolve registration.</p>}
      <div className="schedule-comparison"><table><thead><tr><th>Course</th><th>Before</th><th>Proposed</th><th>Effect</th></tr></thead><tbody>
        {repair.before.map(before => {
          const after = repair.schedule.selections.find(s => s.course.id === before.course.id)!;
          return <tr key={before.course.id}><th>{before.course.code}</th><td>Section {before.section.number} · {before.section.index}<br />{registrationLabels[draft.statuses[before.section.id] ?? 'planned']}{draft.locks.includes(before.section.id) ? ' · locked' : ''}</td>
            <td>Section {after.section.number} · <RegistrationIndex key={after.section.index} index={after.section.index} /></td><td>{before.section.id === after.section.id ? 'Preserved' : draft.statuses[before.section.id] === 'registered' ? 'Registered section would change in this planner only' : 'Replace; new index remains planned'}</td></tr>;
        })}
      </tbody></table></div>
      <WeeklyCalendar selections={repair.schedule.selections} idPrefix="rescue" />
      {repair.schedule.selections.map(s => <p id={`rescue-${s.section.index}`} key={s.section.id} className="muted">{s.course.code}: section {s.section.number}, index {s.section.index}. Review registration readiness above.</p>)}
      <details><summary>Compare ranked repair alternatives</summary><div className="schedule-comparison"><table><thead><tr><th>Repair</th><th>Changes</th><th>Preference penalty</th><th>Eligibility / seats</th></tr></thead><tbody>{result.repairs.map((r, i) => <tr key={r.schedule.id}><td>{i + 1}</td><td>{r.changedIds.length}</td><td>{r.schedule.score}</td><td>{r.requiresReview ? 'Verification needed' : 'No known blocker; WebReg final'}</td></tr>)}</tbody></table></div></details>
      {!!repair.introducedRestrictions.length && <><h4>New or changed restrictions</h4><ul className="generation-notes">{repair.introducedRestrictions.map(text => <li key={text}>{text}</li>)}</ul></>}
      <details><summary>Registration requirements and source evidence</summary><RegistrationReadiness selections={repair.schedule.selections} profile={profile} /></details>
      <p className="muted">Timetable: supplied weekly meetings do not overlap. Eligibility: limited evidence checks above. Seats: {result.availability.state === 'fresh' ? 'checked at the time shown in search details, subject to change' : 'not currently verified'}. Registration: self-reported only; no enrollment transaction occurs here.</p>
      <details><summary>Timetable and source limitations</summary><ul className="generation-notes">{repair.schedule.limitations.map(text => <li key={text}>{text}</li>)}</ul></details>
      <label className="academic-checkbox"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />I approve the complete before/after planner change and will verify seats, eligibility, and registration in Rutgers systems.</label>
      {!!protectedChanges.length && <label className="academic-checkbox"><input type="checkbox" checked={protectedApproval} onChange={e => setProtectedApproval(e.target.checked)} />I explicitly approve changing protected indexes {protectedChanges.map(id => id.split(':').at(-1)).join(', ')} in this planner. Registered classes are not dropped from WebReg.</label>}
      <button className="button" disabled={!approved || stale || (!!protectedChanges.length && !protectedApproval) || applied || !repair.changedIds.length} onClick={() => {
        if (onApply(repair, result.basis, overrides)) setApplied(true);
      }}>Apply approved repair</button>
      {applied && <p role="status">Repair applied to the local planner. New sections are planned, not registered. WebReg enrollment is unchanged; undo is available below. <a href="#manual-schedule" className="back-link">Review planner and undo →</a></p>}
    </>}
    <details><summary>Search details and availability evidence</summary>
    <p className="muted">{result.visited.toLocaleString()} search steps. {result.truncated ? 'Search truncated: best repair found only; global minimum disruption is not proved.' : result.repairs.length ? 'Search completed at the smallest feasible change budget.' : 'Your draft and protections are unchanged.'}</p>
    <p className="availability-evidence"><strong>{result.availability.state === 'fresh' ? 'Verified fresh SOC response' : result.availability.state === 'unverified' ? 'Unverified SOC response · snapshot-only recovery' : `${result.availability.state} availability`}</strong><br />{result.availability.message}
      {result.availability.retrievedAt && <><br />Actual successful retrieval: {result.availability.retrievedAt}</>}
      {result.availability.checkedAt && <><br />Last attempt: {result.availability.checkedAt}</>}
    </p>
    </details>
  </section>;
}
