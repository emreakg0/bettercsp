import { evaluateEligibility } from '@/lib/eligibility/evaluate';
import { statusLabels, type EligibilityFinding, type StudentProfile } from '@/lib/eligibility/types';
import type { Selection } from '@/lib/scheduling/selection';

const isBlocker = (finding: EligibilityFinding): boolean =>
  finding.status === 'permission-required' || finding.status === 'potentially-ineligible';

const categories = { honors: 'Honors admission', prerequisite: 'Prerequisites', permission: 'Special permission', standing: 'Class standing', 'school-major': 'School / major / minor', placement: 'Placement', other: 'Other enrollment conditions' };
// The same findings render in manual drafts, generated previews, and filtered-candidate explanations.
export function ReadinessFindings({ findings }: { findings: EligibilityFinding[] }) {
  return <ul className="readiness-findings">{findings.map((finding, i) => {
    const instructions = finding.status === 'permission-required';
    const source = instructions ? finding.evidence.at(-1) : finding.evidence[0];
    return <li key={`${finding.rule}:${i}`}>
    <h4>{categories[finding.category]} · {finding.excludable ? 'Conflicts with your reported information' : statusLabels[finding.status]}</h4><p>{finding.message}</p>
    {finding.excludable && <p>The reported information does not match a listed enrollment requirement.</p>}
    {finding.status === 'verification-needed' && !!finding.missing.length && <p className="muted">To check: {finding.missing.join(', ')}.</p>}
    <p><strong>Next step: </strong>{finding.nextStep}</p>
    {source && <a href={source.url} target="_blank" rel="noreferrer">Rutgers {instructions ? 'permission instructions' : 'source'} ↗</a>}
    <details><summary>Source evidence</summary>{finding.evidence.map((evidence, j) => <div key={j}>
      <p>{evidence.text}</p><a href={evidence.url} target="_blank" rel="noreferrer">{evidence.field} · Rutgers source ↗</a>
    </div>)}</details>
    </li>;
  })}</ul>;
}
export function RegistrationReadiness({ selections, profile, onRescue }: { selections: Selection[]; profile: StudentProfile; onRescue?: () => void }) {
  if (!selections.length) return null;
  const assessments = selections.map(selection => ({
    ...selection, result: evaluateEligibility(selection.course, selection.section, profile),
  }));
  const blockers = assessments.filter(({ result }) => result.findings.some(isBlocker))
    .sort((a, b) => Number(b.result.confirmedIncompatible) - Number(a.result.confirmedIncompatible));
  const review = assessments.filter(({ result }) => result.findings.some(f => f.status === 'verification-needed'));
  const clear = assessments.filter(({ result }) => result.status === 'no-known-blocker');
  return <section className="registration-readiness" aria-label="Registration readiness">
    <h3>Registration readiness</h3>
    <p className="muted">WebReg determines eligibility. Review these findings before registration.</p>
    {blockers.map(({ course, section, result }) => <details className={`readiness-section readiness-${result.status}`} key={section.id} open>
      <summary><strong>{course.code} · section {section.number}</strong><span>{result.confirmedIncompatible ? 'Reported information conflicts with requirement' : statusLabels[result.status]}</span></summary>
      <ReadinessFindings findings={result.findings.filter(isBlocker)} />
      {onRescue && <button className="text-button" onClick={onRescue}>Review recovery options for {course.code}</button>}
    </details>)}
    {!!review.length && <details className="readiness-section"><summary><strong>Needs verification · {review.length} {review.length === 1 ? 'section' : 'sections'}</strong></summary>
      <p className="muted">Confirm prerequisites, placement, or other conditions with Rutgers where listed below.</p>
      {review.map(({ course, section, result }) => <div key={section.id}><h4>{course.code} · section {section.number}</h4>
        <ReadinessFindings findings={result.findings.filter(f => f.status === 'verification-needed')} /></div>)}
    </details>}
    {assessments.some(({ result }) => result.status !== 'no-known-blocker' && result.findings.some(f => f.status === 'no-known-blocker')) && <details className="readiness-section">
      <summary>Other checks with no known blocker</summary>
      {assessments.filter(({ result }) => result.status !== 'no-known-blocker').map(({ course, section, result }) => {
        const met = result.findings.filter(f => f.status === 'no-known-blocker');
        return met.length ? <div key={section.id}><p>{course.code} · section {section.number}</p><ReadinessFindings findings={met} /></div> : null;
      })}
    </details>}
    {!!clear.length && <details className="readiness-section"><summary><strong>No known blocker · {clear.length} {clear.length === 1 ? 'section' : 'sections'}</strong></summary>
      {clear.map(({ course, section, result }) => <div key={section.id}><p>{course.code} · section {section.number}</p>
        {!!result.findings.length && <ReadinessFindings findings={result.findings} />}</div>)}
    </details>}
  </section>;
}
