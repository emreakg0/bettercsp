import { createHash } from 'node:crypto';
import { evaluateEligibility } from '../eligibility/evaluate.ts';
import { emptyProfile, type StudentProfile } from '../eligibility/types.ts';
import type { Course } from '../catalog/types.ts';
import { plannerCourse, type Selection } from './selection.ts';
import { exclusionReason, sectionsOverlap, type Candidate } from './candidates.ts';
import { equivalentCourseGroups, linkageNotices } from './relationships.ts';
import { scoreSchedule } from './scoring.ts';
import { parseGenerationRequest } from './generation-request.ts';
import type { CandidateReport, GenerationRequest, GenerationResult, RankedSchedule } from './generation-types.ts';

type Domain = { course: Course; required: boolean; candidates: Candidate[] };
type Found = ReturnType<typeof scoreSchedule> & { id: string; picked: Candidate[]; optionalIncluded: number; changed: number };
const compare = (a: Found, b: Found): number => a.changed - b.changed || b.optionalIncluded - a.optionalIncluded || a.score - b.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function prepare(courses: Course[], request: GenerationRequest): { domains: Domain[]; reports: CandidateReport[]; issues: string[] } {
  const choices = new Map<string, boolean>();
  for (const choice of request.choices) choices.set(choice.courseId, !!choices.get(choice.courseId) || choice.required);
  const issues: string[] = [], reports: CandidateReport[] = [], domains: Domain[] = [];
  for (const id of request.constraints.lockedSectionIds) {
    const course = courses.find(c => c.sections.some(s => s.id === id));
    if (!course) issues.push(`Locked section ${id} is absent from this catalog.`);
    else choices.set(course.id, true);
  }
  if (!choices.size || choices.size > 12) issues.push('Choose between 1 and 12 courses, including all locked courses.');
  for (const [id, required] of choices) {
    const course = courses.find(c => c.id === id);
    if (!course) { issues.push(`Course ${id} is absent from this catalog.`); continue; }
    const locks = course.sections.filter(s => request.constraints.lockedSectionIds.includes(s.id));
    if (locks.length > 1) issues.push(`More than one section is locked for ${course.code}. Unlock one before generating.`);
    const report: CandidateReport = { courseId: id, code: course.code, total: course.sections.length, candidates: 0, exclusions: {} };
    const candidates: Candidate[] = [];
    for (const section of course.sections) {
      let reason = locks.length && !locks.some(s => s.id === section.id) ? 'Different section is locked' : exclusionReason(section, request.constraints);
      if (!reason && request.eligibility?.excludeConfirmed) {
        const assessment = evaluateEligibility(course, section, request.eligibility.profile);
        if (assessment.confirmedIncompatible) {
          reason = 'Confirmed eligibility mismatch with reported information';
          report.eligibilityExclusions ??= [];
          if (report.eligibilityExclusions.length < 20) report.eligibilityExclusions.push({ index: section.index, findings: assessment.findings.filter(f => f.excludable) });
        }
      }
      if (reason) report.exclusions[reason] = (report.exclusions[reason] ?? 0) + 1;
      else candidates.push({ course, section });
    }
    candidates.sort((a, b) => a.section.id < b.section.id ? -1 : a.section.id > b.section.id ? 1 : 0);
    report.candidates = candidates.length; reports.push(report);
    if (required && !candidates.length) issues.push(`${course.code} has no usable section under these constraints${locks.length ? ' (including its lock)' : ''}. Review exclusions, hours, days, or timing below.`);
    domains.push({ course, required, candidates });
  }
  if (domains.reduce((n, d) => n + d.candidates.length, 0) > 2000) issues.push('Candidate limit exceeded. Exclude sections or choose fewer courses.');
  domains.sort((a, b) => Number(b.required) - Number(a.required) || a.candidates.length - b.candidates.length || (a.course.id < b.course.id ? -1 : 1));
  return { domains, reports, issues };
}
function describe(found: Found, domains: Domain[], cached: Map<string, Selection>, profile: StudentProfile): RankedSchedule {
  const selections = found.picked.map(({ course, section }) => {
    let selection = cached.get(section.id);
    if (!selection) {
      const { sections, ...info } = plannerCourse(course);
      selection = { course: info, section: sections.find(s => s.id === section.id)! };
      cached.set(section.id, selection);
    }
    return selection;
  }).sort((a, b) => a.section.id < b.section.id ? -1 : 1);
  const restrictions = found.picked.flatMap(({ course, section }) => [
    ...(course.prerequisites ? [{ field: 'Prerequisites', text: course.prerequisites }] : []), ...course.notes, ...section.notices,
  ].map(notice => ({ ...notice, courseCode: course.code, sectionIndex: section.index })));
  const limitations = ['Eligibility checks cover supported rules and self-reported information only. WebReg is the final authority; separately registered components still need review.',
    'Availability is a snapshot, not a live seat check. Scores do not measure eligibility or availability.',
    'Weekly overlaps only; session dates, exam times, and bus travel durations are not verified. Campus changes are a preliminary proxy.'];
  for (const { course, section } of found.picked) {
    for (const text of linkageNotices(course, section)) limitations.push(`${course.code}: required-component or co-requisite review — ${text}`);
    if (section.availability !== 'open') limitations.push(`${course.code} section ${section.number}: ${section.availability} in snapshot; keep as a planning alternative only.`);
    if (section.meetings.some(m => !m.campus)) limitations.push(`${course.code}: missing locations make campus/commute metrics incomplete.`);
  }
  return { id: found.id, selections, score: found.score, metrics: found.metrics, breakdown: found.breakdown,
    optionalIncluded: found.optionalIncluded, restrictions, eligibility: found.picked.map(({ course, section }) => evaluateEligibility(course, section, profile)), limitations: [...new Set(limitations)],
    omittedCourses: domains.filter(d => !found.picked.some(p => p.course.id === d.course.id)).map(d => d.course.code) };
}

// Distinguish a changed replay from a catalog or server failure.
export class StaleDiscoveryError extends Error {}

export function generateSchedules(courses: Course[], input: GenerationRequest, limits: { maxNodes?: number; maxResults?: number; baseline?: { courseId: string; sectionId: string }[]; maxChanges?: number; discoveryOffset?: number; discoveryRevision?: string } = {}): GenerationResult {
  const request = parseGenerationRequest(input);
  const maxNodes = Number.isFinite(limits.maxNodes) ? Math.max(1, Math.min(50000, Math.floor(limits.maxNodes!))) : 25000;
  const offset = limits.discoveryOffset;
  const maxResults = offset !== undefined ? 60 : Number.isFinite(limits.maxResults) ? Math.max(1, Math.min(20, Math.floor(limits.maxResults!))) : 10;
  const { domains, reports, issues } = prepare(courses, request);
  const baseline = new Map(limits.baseline?.map(item => [item.courseId, item.sectionId]) ?? []);
  const maxChanges = Number.isFinite(limits.maxChanges) ? Math.max(0, Math.floor(limits.maxChanges!)) : Infinity;
  if (baseline.size) for (const domain of domains) domain.candidates.sort((a, b) => Number(b.section.id === baseline.get(domain.course.id)) - Number(a.section.id === baseline.get(domain.course.id)) || (a.section.id < b.section.id ? -1 : 1));
  const result: GenerationResult = { schedules: [], reports, issues, visited: 0, completed: 0, truncated: false };
  // The same bounded traversal and retained ranking are replayed for each ten-result page.
  const discovery = offset === undefined ? undefined : {
    upperBound: domains.length ? domains.reduce((total, d) => total * BigInt(d.candidates.length + Number(!d.required)), BigInt(1)).toString() : '0',
    evaluated: 0, uniqueValid: 0, retained: 0, nextCursor: null as string | null,
  };
  if (discovery) result.discovery = discovery;
  if (issues.length) return result;
  const groups = equivalentCourseGroups(domains.map(d => d.course));
  const required = domains.filter(d => d.required);
  for (let i = 0; i < required.length; i++) for (let j = i + 1; j < required.length; j++) {
    if (groups.get(required[i].course.id) === groups.get(required[j].course.id)) {
      result.issues.push(`${required[i].course.code} and ${required[j].course.code} are cross-listed or same-course alternatives. Choose one offering: remove a retained selection or make a target optional.`);
    }
  }
  if (result.issues.length) return result;
  const pairCache = new Map<string, boolean>(), best: Found[] = [], seen = new Set<string>();
  const picked: Candidate[] = [];
  function spend(): boolean {
    if (result.visited >= maxNodes) { result.truncated = true; return false; }
    result.visited++; return true;
  }
  function compatible(candidate: Candidate): boolean {
    if (!spend()) return false;
    return picked.every(other => {
      if (groups.get(other.course.id) === groups.get(candidate.course.id)) return false;
      const key = [candidate.section.id, other.section.id].sort().join('|');
      let overlaps = pairCache.get(key);
      if (overlaps === undefined) { overlaps = sectionsOverlap(candidate.section, other.section); if (pairCache.size < 10000) pairCache.set(key, overlaps); }
      return !overlaps;
    });
  }
  function search(depth: number, optionalIncluded: number, changed: number): void {
    if (!spend() || changed > maxChanges) return;
    if (!discovery && !baseline.size && best.length === maxResults && optionalIncluded + domains.slice(depth).filter(d => !d.required).length < best[best.length - 1].optionalIncluded) return;
    if (depth === domains.length) {
      if (!picked.length) return;
      result.completed++;
      const id = picked.map(c => c.section.id).sort().join('|');
      if (seen.has(id)) return;
      if (discovery) { seen.add(id); discovery.uniqueValid++; }
      const found = { ...scoreSchedule(picked.map(c => c.section), request.weights, request.preferredInstructors), id, picked: [...picked], optionalIncluded, changed };
      if (best.length < maxResults || compare(found, best[best.length - 1]) < 0) {
        best.push(found); best.sort(compare); seen.add(id);
        if (best.length > maxResults) {
          const dropped = best.pop()!;
          if (!discovery) seen.delete(dropped.id);
        }
      }
      return;
    }
    const domain = domains[depth];
    for (const candidate of domain.candidates) {
      // Count rejected branches as work too, so impossible instances remain bounded.
      if (!spend()) return;
      const nextChanges = changed + Number(baseline.has(domain.course.id) && baseline.get(domain.course.id) !== candidate.section.id);
      if (nextChanges > maxChanges) continue;
      const matches = compatible(candidate);
      if (discovery && !result.truncated && depth === domains.length - 1) discovery.evaluated++;
      if (!matches) continue;
      picked.push(candidate);
      const feasible = domains.slice(depth + 1).every(d => !d.required || d.candidates.some(compatible));
      if (feasible) search(depth + 1, optionalIncluded + Number(!domain.required), nextChanges);
      picked.pop();
    }
    if (!domain.required && !result.truncated) {
      if (discovery && picked.length && result.visited < maxNodes && depth === domains.length - 1) discovery.evaluated++;
      search(depth + 1, optionalIncluded, changed + Number(baseline.has(domain.course.id)));
    }
  }
  search(0, 0, 0);
  const cache = new Map<string, Selection>();
  if (discovery && offset !== undefined) {
    discovery.retained = best.length;
    const revision = createHash('sha256').update(JSON.stringify([request, discovery, best.map(({ id, score }) => [id, score])])).digest('hex');
    if (limits.discoveryRevision && limits.discoveryRevision !== revision) throw new StaleDiscoveryError('The schedule search changed. Generate schedules again.');
    if (offset + 10 < best.length) discovery.nextCursor = `${offset + 10}:${revision}`;
  }
  result.schedules = (offset === undefined ? best : best.slice(offset, offset + 10)).map(found => describe(found, domains, cache, request.eligibility?.profile ?? emptyProfile));
  if (!best.length) result.issues.push(result.truncated
    ? 'No schedule found within the search budget. Reduce the course set or narrow sections and try again.'
    : 'No compatible schedule exists under these constraints. Review locks, cross-listed duplicates, hours, days off, or make a course optional.');
  return result;
}
