import { readSavedIds } from '../scheduling/selection.ts';
import { parseGenerationRequest } from '../scheduling/generation-request.ts';
import { parseRegistrationStatuses } from './state.ts';
import type { RescueRequest } from './types.ts';

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
