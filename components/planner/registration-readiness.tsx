import { evaluateEligibility } from '@/lib/eligibility/evaluate';
import { statusLabels, eligibilityPriority, type EligibilityFinding, type StudentProfile } from '@/lib/eligibility/types';
import type { Selection } from '@/lib/scheduling/selection';

const categories = { honors: 'Honors admission', prerequisite: 'Prerequisites', permission: 'Special permission', standing: 'Class standing', 'school-major': 'School / major / minor', placement: 'Placement', other: 'Other enrollment conditions' };
// The same findings render in manual drafts, generated previews, and filtered-candidate explanations.
export function ReadinessFindings({ findings }: { findings: EligibilityFinding[] }) {
  return <ul className="readiness-findings">{findings.map((finding, i) => <li key={`${finding.rule}:${i}`}>
    <h4>{categories[finding.category]} · {statusLabels[finding.status]}</h4><p>{finding.message}</p>
    {!!finding.missing.length && <p className="muted">Missing information: {finding.missing.join('; ')}.</p>}
    <p><strong>Next step: </strong>{finding.nextStep}</p>
    <details><summary>Source evidence</summary>{finding.evidence.map((evidence, j) => <div key={j}>
      <p>{evidence.text}</p><a href={evidence.url} target="_blank" rel="noreferrer">{evidence.field} · Rutgers source ↗</a>
    </div>)}</details>
  </li>)}</ul>;
}
export function RegistrationReadiness({ selections, profile }: { selections: Selection[]; profile: StudentProfile }) {
  if (!selections.length) return null;
  const assessments = selections.map(selection => ({ ...selection, result: evaluateEligibility(selection.course, selection.section, profile) })).sort((a, b) => eligibilityPriority.indexOf(a.result.status) - eligibilityPriority.indexOf(b.result.status));
  const actionable = assessments.filter(a => a.result.status !== 'no-known-blocker').length;
  return <section className="registration-readiness" aria-label="Registration readiness">
    <h3>Registration readiness</h3><p className="muted">{actionable} of {assessments.length} sections need review. These are limited checks against self-reported facts and snapshot metadata; WebReg makes the final decision. Seat availability and timetable feasibility are separate.</p>
    {assessments.map(({ course, section, result }) => {
      const unresolved = result.findings.filter(f => f.status !== 'no-known-blocker'), met = result.findings.filter(f => f.status === 'no-known-blocker');
      return <details className={`readiness-section readiness-${result.status}`} key={section.id} open={result.status === 'permission-required' || result.status === 'potentially-ineligible'}>
        <summary><strong>{course.code} · section {section.number} · index {section.index}</strong><span>{statusLabels[result.status]}</span></summary>
        {!!unresolved.length && <ReadinessFindings findings={unresolved} />}
        {!!met.length && <details><summary>Checks with no known blocker</summary><ReadinessFindings findings={met} /></details>}
        {result.status === 'no-known-blocker' && <p className="muted">No blocker was found by the supported checks. This is not guaranteed enrollment, verified eligibility, or a reserved seat; unmodeled rules may still apply.</p>}
      </details>;
    })}
  </section>;
}
