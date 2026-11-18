import 'server-only';
import { createAvailabilityReader } from './evidence.ts';
export const getAvailability = createAvailabilityReader();
