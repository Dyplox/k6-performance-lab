/**
 * Estrés: escalones hasta 4x la carga nominal para encontrar el punto de degradación.
 * Se aborta sola si el error supera 5 %. Solo manual.
 */
import { buildOptions } from '../lib/scenarios.ts';
import { assertCredentialsAreValid } from '../lib/auth.ts';
import { assertSutIsUp } from '../lib/sut.ts';
import { makeHandleSummary } from '../report/summary.ts';

export { browseFlow as browse } from '../flows/browse.ts';
export { bookingCrudFlow as book } from '../flows/booking-crud.ts';

export const options = buildOptions('stress');

export function setup(): void {
  assertSutIsUp();
  assertCredentialsAreValid();
}

export const handleSummary = makeHandleSummary('stress');
