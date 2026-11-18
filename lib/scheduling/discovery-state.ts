// Discovery needs bounded ordinal state distinct from the schedule response and from Rescue.
export const discoveryWindowSteps = 25_000;
export const discoveryWindowLimit = 12;
export const discoveryPageSize = 10;
export const initialShortlistSize = 60;

export interface DiscoveryCheckpoint {
  frontier: { path: number[]; next: number } | null;
  pending: number[][];
  windows: number;
  visited: number;
  evaluated: number;
  uniqueValid: number;
  retained: number;
}
