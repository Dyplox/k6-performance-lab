/**
 * Resistencia: carga moderada prolongada (5 min por defecto; TIME_SCALE=48 son 4 h).
 * Busca degradación lenta: memoria, crecimiento de datos. Solo manual.
 */
import { buildOptions } from '../lib/scenarios.ts';
import { assertCredentialsAreValid } from '../lib/auth.ts';
import { assertSutIsUp } from '../lib/sut.ts';
import { makeHandleSummary } from '../report/summary.ts';

export { browseFlow as browse } from '../flows/browse.ts';
export { bookingCrudFlow as book } from '../flows/booking-crud.ts';

export const options = buildOptions('soak');

export function setup(): void {
  assertSutIsUp();
  assertCredentialsAreValid();
}

export const handleSummary = makeHandleSummary('soak');
