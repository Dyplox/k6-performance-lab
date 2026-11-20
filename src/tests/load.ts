/**
 * Carga: tasa nominal sostenida (ramping-arrival-rate). Valida los SLOs y alimenta la línea base.
 * Corre programada (semanal) o manual.
 */
import { buildOptions } from '../lib/scenarios.ts';
import { assertCredentialsAreValid } from '../lib/auth.ts';
import { assertSutIsUp } from '../lib/sut.ts';
import { makeHandleSummary } from '../report/summary.ts';

export { browseFlow as browse } from '../flows/browse.ts';
export { bookingCrudFlow as book } from '../flows/booking-crud.ts';

export const options = buildOptions('load');

export function setup(): void {
  assertSutIsUp();
  assertCredentialsAreValid();
}

export const handleSummary = makeHandleSummary('load');
