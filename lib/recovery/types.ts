import type { GenerationRequest, RankedSchedule } from '../scheduling/generation-types.ts';
import type { Selection } from '../scheduling/selection.ts';

export type RegistrationStatus = 'planned' | 'registered' | 'failed' | 'needs-permission' | 'needs-verification';
export const registrationLabels: Record<RegistrationStatus, string> = {
  planned: 'Planned', registered: 'Registered (self-reported)', failed: 'Registration failed',
  'needs-permission': 'Needs permission', 'needs-verification': 'Needs verification',
};
export type RegistrationStatuses = Record<string, RegistrationStatus>;
// Explicit availability assurance prevents an unverified endpoint response from becoming a seat claim.
export interface AvailabilityEvidence {
  sourceId: string; state: 'fresh' | 'stale' | 'failed' | 'snapshot' | 'unverified';
  retrievedAt: string | null; checkedAt: string | null; openIndexes: string[]; message: string;
}
export interface RescueDraft { selections: Selection[]; locks: string[]; statuses: RegistrationStatuses }
export interface RescueRequest {
  sectionIds: string[]; statuses: RegistrationStatuses; settings: GenerationRequest;
  replaceSectionIds: string[]; overrideProtectionIds: string[];
}
export interface RescueProblem {
  sectionId: string; source: 'student' | 'eligibility' | 'timetable' | 'availability';
  message: string; requiresReplacement: boolean;
}
export interface Repair {
  schedule: RankedSchedule; changedIds: string[]; introducedRestrictions: string[];
  before: Selection[]; requiresReview: boolean;
}
export interface RescueResult {
  basis: string; problems: RescueProblem[]; protectedIds: string[]; repairs: Repair[];
  availability: AvailabilityEvidence; issues: string[]; visited: number; truncated: boolean;
  changeBudget: number | null;
}
