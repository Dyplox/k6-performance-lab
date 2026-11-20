/**
 * Picos: subida brusca a 20x y vuelta a la normalidad. Mide si el sistema aguanta y se recupera.
 * Solo manual.
 */
import { buildOptions } from '../lib/scenarios.ts';
import { assertCredentialsAreValid } from '../lib/auth.ts';
import { assertSutIsUp } from '../lib/sut.ts';
import { makeHandleSummary } from '../report/summary.ts';

export { browseFlow as browse } from '../flows/browse.ts';
export { bookingCrudFlow as book } from '../flows/booking-crud.ts';

export const options = buildOptions('spike');

export function setup(): void {
  assertSutIsUp();
  assertCredentialsAreValid();
}

export const handleSummary = makeHandleSummary('spike');
