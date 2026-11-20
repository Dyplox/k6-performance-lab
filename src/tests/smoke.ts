/**
 * Smoke: 1 VU por flujo durante 30 s. Verifica que todo funciona y cumple los SLOs con carga mínima.
 * Corre en cada PR.
 */
import { buildOptions } from '../lib/scenarios.ts';
import { assertCredentialsAreValid } from '../lib/auth.ts';
import { assertSutIsUp } from '../lib/sut.ts';
import { makeHandleSummary } from '../report/summary.ts';

export { browseFlow as browse } from '../flows/browse.ts';
export { bookingCrudFlow as book } from '../flows/booking-crud.ts';

export const options = buildOptions('smoke');

export function setup(): void {
  assertSutIsUp();
  assertCredentialsAreValid();
}

export const handleSummary = makeHandleSummary('smoke');
