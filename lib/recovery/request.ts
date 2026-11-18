import { readSavedIds } from '../scheduling/selection.ts';
import { parseGenerationRequest } from '../scheduling/generation-request.ts';
import { parseRegistrationStatuses } from './state.ts';
import type { RescueRequest } from './types.ts';
import { csFallbackCodes, csRescueTerm } from '../academic/rutgers-cs.ts';

export function parseRescueRequest(value: unknown, sourceId: string): RescueRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Rescue settings.');
  const input = value as Record<string, unknown>;
  const ids = (value: unknown): string[] => readSavedIds(JSON.stringify({ version: 1, sourceId, sectionIds: value }), sourceId);
  const sectionIds = ids(input.sectionIds), replaceSectionIds = ids(input.replaceSectionIds), overrideProtectionIds = ids(input.overrideProtectionIds);
  if (!sectionIds.length || sectionIds.length > 12) throw new Error('Rescue supports 1–12 selected sections.');
  const settings = parseGenerationRequest(input.settings);
  if ([...replaceSectionIds, ...overrideProtectionIds, ...settings.constraints.lockedSectionIds].some(id => !sectionIds.includes(id))) throw new Error('A replacement, override, or lock is outside the current draft.');
  return { sectionIds, replaceSectionIds, overrideProtectionIds, settings, statuses: parseRegistrationStatuses(input.statuses, sourceId) };
}

export function parseCourseFallback(value: unknown, draft: RescueRequest, sourceId: string): { targetId: string; candidateCodes: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || sourceId !== csRescueTerm || draft.overrideProtectionIds.length) {
    throw new Error('Course alternatives are unavailable for this draft.');
  }
  const { targetId, candidateCodes } = value as Record<string, unknown>;
  if (typeof targetId !== 'string' || !draft.sectionIds.includes(targetId) || !Array.isArray(candidateCodes) ||
    candidateCodes.length > csFallbackCodes.size || !candidateCodes.every(code => typeof code === 'string' && csFallbackCodes.has(code))) {
    throw new Error('Invalid course alternative request.');
  }
  return { targetId, candidateCodes: [...new Set(candidateCodes as string[])] };
}
