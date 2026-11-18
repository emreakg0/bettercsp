import { parseStudentProfile } from '../eligibility/profile.ts';
import type { GenerationRequest } from './generation-types.ts';
import { weekDays } from './meetings.ts';

// A small shared validator matches the existing dependency-free trust-boundary approach.
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a settings object.');
  return value as Record<string, unknown>;
}
function strings(value: unknown, maximum = 100): string[] {
  if (!Array.isArray(value) || value.length > maximum || !value.every(s => typeof s === 'string' && s.length > 0 && s.length <= 180)) {
    throw new Error('A selection list is invalid or too large.');
  }
  return [...new Set(value as string[])];
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error('A numeric preference is outside its allowed range.');
  return value;
}
export function parseGenerationRequest(value: unknown): GenerationRequest {
  const input = object(value), hard = object(input.constraints), weights = object(input.weights);
  if (!Array.isArray(input.choices) || input.choices.length > 12) throw new Error('Choose up to 12 courses.');
  const choices = input.choices.map(value => {
    const choice = object(value);
    if (typeof choice.courseId !== 'string' || !choice.courseId.length || choice.courseId.length > 180 || typeof choice.required !== 'boolean') throw new Error('A course choice is invalid.');
    return { courseId: choice.courseId, required: choice.required };
  });
  const earliestStart = integer(hard.earliestStart, 0, 1439), latestEnd = integer(hard.latestEnd, 0, 1439);
  if (earliestStart > latestEnd) throw new Error('Latest end must be at or after earliest start.');
  const daysOff = strings(hard.daysOff, 7);
  if (daysOff.some(day => !weekDays.some(valid => valid === day))) throw new Error('A day-off code is invalid.');
  let eligibility: GenerationRequest['eligibility'];
  if (input.eligibility !== undefined) {
    const settings = object(input.eligibility);
    if (typeof settings.excludeConfirmed !== 'boolean') throw new Error('Invalid eligibility filtering policy.');
    eligibility = { profile: parseStudentProfile(settings.profile), excludeConfirmed: settings.excludeConfirmed };
  }
  return { choices, eligibility, constraints: { earliestStart, latestEnd, daysOff,
    excludedSectionIds: strings(hard.excludedSectionIds), lockedSectionIds: strings(hard.lockedSectionIds, 12),
    excludedCampuses: strings(hard.excludedCampuses, 20) },
  weights: { lateEvenings: weights.lateEvenings === undefined ? 0 : integer(weights.lateEvenings, 0, 10), daysOff: integer(weights.daysOff, 0, 10), laterStarts: integer(weights.laterStarts, 0, 10),
    gaps: integer(weights.gaps, 0, 10), campusChanges: integer(weights.campusChanges, 0, 10),
    commuteDays: integer(weights.commuteDays, 0, 10), instructors: integer(weights.instructors, 0, 10) },
  preferredInstructors: strings(input.preferredInstructors, 20) };
}
