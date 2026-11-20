/**
 * Datos de prueba parametrizados.
 *
 * SharedArray carga el JSON una sola vez y lo comparte entre todos los VUs (solo lectura),
 * en vez de tener una copia por VU: con cientos de VUs la diferencia de memoria es grande.
 */
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

export interface BookingDates {
  checkin: string;
  checkout: string;
}

export interface Booking {
  firstname: string;
  lastname: string;
  totalprice: number;
  depositpaid: boolean;
  bookingdates: BookingDates;
  additionalneeds?: string;
}

// import.meta.resolve fija la ruta relativa a este módulo, así el archivo se encuentra igual
// sin importar qué prueba (src/tests/*.ts) lo cargue ni desde qué carpeta se ejecute k6.
const bookings = new SharedArray<Booking>('bookings', () => {
  const rows = JSON.parse(open(import.meta.resolve('../../data/bookings.json'))) as Booking[];
  if (rows.length === 0) throw new Error('data/bookings.json está vacío');
  return rows;
});

/**
 * Devuelve una reserva distinta en cada iteración y la marca como única.
 *
 * El índice usa la iteración global del escenario, de modo que los VUs recorren el archivo
 * de forma intercalada y no todos repiten la primera fila. El sufijo en `lastname` permite
 * buscar exactamente esta reserva con GET /booking?firstname=…&lastname=… aunque se creen
 * otras con el mismo nombre al mismo tiempo.
 */
export function nextBooking(): Booking {
  const iteration = exec.scenario.iterationInTest;
  const row = bookings[iteration % bookings.length] as Booking;
  return {
    ...row,
    bookingdates: { ...row.bookingdates },
    lastname: `${row.lastname}-${exec.vu.idInTest}-${exec.vu.iterationInScenario}`,
  };
}
