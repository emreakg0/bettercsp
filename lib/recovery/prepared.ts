import { reportedMatch, rescueDegreeProgram, ruleCourses } from '../academic/course-matches.ts';
import type { AcademicPlanningProfile } from '../academic/profile.ts';
import { prerequisiteFinding } from '../eligibility/academic-rules.ts';
import { evaluateEligibility } from '../eligibility/evaluate.ts';
import { eligibilityPriority, type StudentProfile } from '../eligibility/types.ts';
import type { HardConstraints } from '../scheduling/generation-types.ts';
import { readSavedIds, type Selection } from '../scheduling/selection.ts';
import type { CourseFallbackOption, CourseFallbackResult } from './course-fallback.ts';
import { applyCourseFallback, draftSignature, protectedSections } from './state.ts';
import type { RescueDraft } from './types.ts';

export const preparationLimit = 12;
export const preparationOptions = 10;
export const preparationLifetime = 24 * 60 * 60 * 1000;
export const preparedKey = (sourceId: string) => `bettercsp:prepared:v1:${sourceId}`;
export interface Preparation {
  version: 1;
  sourceId: string;
  catalogRevision: string;
  binding: string;
  preparedAt: number;
  entries: { targetId: string; options: CourseFallbackOption[]; truncated: boolean }[];
}

// Reports on these same indexes can change during registration. Application still binds to the full live draft.
export function preparationScope(sourceId: string, revision: string, draft: RescueDraft, academic: AcademicPlanningProfile, settings: unknown): string {
  return JSON.stringify([sourceId, revision, draftSignature({ ...draft, statuses: {} }), academic, settings]);
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
function notices(value: unknown): boolean { return Array.isArray(value) && value.every(item => record(item) && typeof item.field === 'string' && typeof item.text === 'string'); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

function validOption(value: unknown, sourceId: string): value is CourseFallbackOption {
  if (!record(value) || !finite(value.score) || !eligibilityPriority.some(status => status === value.eligibility) ||
      typeof value.needsComponentReview !== 'boolean' || !record(value.selection)) return false;
  const { course, section } = value.selection;
  if (!record(course) || !record(section) || typeof course.id !== 'string' || !course.id.startsWith(sourceId + '~') ||
      typeof course.code !== 'string' || !/^\d{2}:\d{3}:\d{3}$/.test(course.code) ||
      ![course.title, course.prerequisites, course.creditsLabel].every(item => typeof item === 'string') ||
      !(course.credits === null || finite(course.credits)) || !notices(course.notes)) return false;
  if (typeof section.index !== 'string' || !/^\d{5}$/.test(section.index) || section.id !== sourceId + ':' + section.index ||
      typeof section.number !== 'string' || (section.availability !== 'open' && section.availability !== 'unknown') ||
      !strings(section.campuses) || !strings(section.instructors) || !notices(section.notices) ||
      !record(section.delivery) || typeof section.delivery.code !== 'string' || typeof section.delivery.label !== 'string') return false;
  if (section.honors !== null && (!record(section.honors) || (section.honors.kind !== 'designated' && section.honors.kind !== 'program-information') ||
      typeof section.honors.evidence !== 'string')) return false;
  return Array.isArray(section.meetings) && section.meetings.length <= 100 && section.meetings.every(meeting => record(meeting) &&
    (meeting.timing === 'scheduled' || meeting.timing === 'asynchronous') &&
    [meeting.dayCode, meeting.campus, meeting.mode, meeting.building, meeting.room].every(item => typeof item === 'string') &&
    [meeting.startMinute, meeting.endMinute].every(time => time === null || (finite(time) && Number.isInteger(time) && time >= 0 && time < 1440)));
}

export function readPreparation(raw: string | null, sourceId: string, revision: string, binding: string, now = Date.now()): Preparation | null {
  if (!raw || raw.length > 660_000) return null;
  try {
    const value = JSON.parse(raw) as Preparation;
    if (!value || value.version !== 1 || value.sourceId !== sourceId || value.catalogRevision !== revision || value.binding !== binding ||
        !finite(value.preparedAt) || value.preparedAt > now || value.preparedAt <= now - preparationLifetime ||
        !Array.isArray(value.entries) || !value.entries.length || value.entries.length > preparationLimit) return null;
    const ids = value.entries.map(entry => entry.targetId);
    if (readSavedIds(JSON.stringify({ version: 1, sourceId, sectionIds: ids }), sourceId).length !== ids.length) return null;
    for (const entry of value.entries) {
      if (typeof entry.truncated !== 'boolean' || !Array.isArray(entry.options) || entry.options.length > preparationOptions ||
          !entry.options.every(option => validOption(option, sourceId) && option.selection.section.id !== entry.targetId) ||
          new Set(entry.options.map(option => option.selection.section.id)).size !== entry.options.length) return null;
    }
    return value;
  } catch { return null; }
}

function dependsOnFailure(candidate: Selection, failed: string[], academic: AcademicPlanningProfile, profile: StudentProfile, sourceId: string): boolean {
  if (!failed.length) return false;
  const completedCourses = profile.completedCourses.filter(code => !failed.includes(code));
  const prerequisites: string[] = candidate.course.prerequisites.match(/\b\d{2}:\d{3}:\d{3}\b/g) ?? [];
  const mentions = (text: string, code: string): boolean => {
    if (text.includes(code)) return true;
    const subject = code.startsWith('01:198:') ? 'CS' : code.startsWith('01:640:') ? 'Math' : null;
    return !!subject && new RegExp('\\b' + subject + '\\s*' + code.slice(-3) + '\\b', 'i').test(text);
  };
  if ([...candidate.course.notes, ...candidate.section.notices].some(note =>
    /pre[ -]?req|co[ -]?req|concurrent/i.test(note.field + ' ' + note.text) && failed.some(code => mentions(note.text, code)))) return true;
  if (failed.some(code => prerequisites.includes(code) || mentions(candidate.course.prerequisites, code)) && prerequisiteFinding(candidate.course, candidate.section, { ...profile, completedCourses })?.status !== 'no-known-blocker') return true;
  const documented = rescueDegreeProgram(academic, sourceId)?.prerequisites.find(edge => edge.courseCode === candidate.course.code);
  return !!documented && ruleCourses(documented.prerequisite).some(code => failed.includes(code)) && !reportedMatch(documented.prerequisite, completedCourses);
}

export function applicablePreparation(cache: Preparation | null, draft: RescueDraft, target: Selection, academic: AcademicPlanningProfile,
  profile: StudentProfile, constraints: HardConstraints | null, now = Date.now()): CourseFallbackResult | null {
  if (!cache || cache.preparedAt <= now - preparationLifetime || !constraints || protectedSections(draft).includes(target.section.id) ||
      draft.statuses[target.section.id] !== 'failed' || Object.entries(draft.statuses).some(([id, status]) =>
        status === 'registered' && !draft.selections.some(item => item.section.id === id))) return null;
  const entry = cache.entries.find(item => item.targetId === target.section.id);
  if (!entry) return null;
  const basis = draftSignature(draft);
  const failed = draft.selections.filter(item => draft.statuses[item.section.id] === 'failed').map(item => item.course.code);
  const options = entry.options.filter(({ selection }) => {
    const eligibility = evaluateEligibility(selection.course, selection.section, profile);
    if (eligibility.confirmedIncompatible || eligibility.findings.some(finding => finding.status === 'permission-required') ||
        dependsOnFailure(selection, failed, academic, profile, cache.sourceId)) return false;
    try { applyCourseFallback(draft, target.section.id, selection, basis, constraints); return true; }
    catch { return false; }
  });
  return options.length ? { basis, options, truncated: entry.truncated, visited: 0 } : null;
}
