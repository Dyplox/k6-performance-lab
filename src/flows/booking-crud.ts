/**
 * Flujo "reservar": ciclo de vida completo de una reserva, como lo haría un cliente de la API.
 *
 *   crear → leer → buscar por nombre → actualizar (PUT) → modificar (PATCH) → borrar → confirmar 404
 *
 * Cada paso valida status y cuerpo. Las reservas se borran al final de cada iteración para que la
 * base de datos no crezca durante pruebas largas (soak) y distorsione los tiempos.
 */
import { check, group } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import type { RefinedResponse, ResponseType } from 'k6/http';
import { getToken, invalidateToken } from '../lib/auth.ts';
import { nextBooking, type Booking } from '../lib/data.ts';
import { Endpoint, json, request } from '../lib/http.ts';
import { think } from '../lib/sut.ts';

interface CreatedBooking {
  bookingid?: number;
  booking?: Booking;
}

/** Tiempo de servidor acumulado de todo el flujo (suma de peticiones, sin think time). */
const flowServerTime = new Trend('crud_flow_server_time', true);
const bookingsCreated = new Counter('bookings_created');

function trackTime(acc: { ms: number }, res: RefinedResponse<ResponseType | undefined>): void {
  acc.ms += res.timings.duration;
}

export function bookingCrudFlow(): void {
  const token = getToken();
  const payload = nextBooking();
  const elapsed = { ms: 0 };
  let bookingId: number | undefined;

  group('01 crear reserva', () => {
    const res = request('POST', '/booking', Endpoint.create, payload);
    trackTime(elapsed, res);
    const body = json<CreatedBooking>(res);
    const ok = check(res, {
      'crear: status 200': (r) => r.status === 200,
      'crear: devuelve bookingid': () => Number.isInteger(body?.bookingid),
      'crear: refleja los datos enviados': () =>
        body?.booking?.lastname === payload.lastname &&
        body.booking.totalprice === payload.totalprice,
    });
    if (ok) {
      bookingId = body?.bookingid;
      bookingsCreated.add(1);
    }
  });

  // Sin reserva creada el resto del flujo no tiene sentido; el check fallido ya quedó registrado.
  if (bookingId === undefined) return;
  const path = `/booking/${bookingId}`;
  think();

  group('02 consultar reserva', () => {
    const res = request('GET', path, Endpoint.read);
    trackTime(elapsed, res);
    const body = json<Booking>(res);
    check(res, {
      'leer: status 200': (r) => r.status === 200,
      'leer: es la reserva creada': () =>
        body?.firstname === payload.firstname && body.lastname === payload.lastname,
    });

    const search = request('GET', '/booking', Endpoint.search, undefined, {
      query: { firstname: payload.firstname, lastname: payload.lastname },
    });
    trackTime(elapsed, search);
    const ids = json<{ bookingid: number }[]>(search);
    check(search, {
      'buscar: status 200': (r) => r.status === 200,
      'buscar: encuentra la reserva': () => ids?.some((b) => b.bookingid === bookingId) === true,
    });
  });
  think();

  group('03 modificar reserva', () => {
    const updated: Booking = { ...payload, totalprice: payload.totalprice + 50, depositpaid: true };
    const put = request('PUT', path, Endpoint.update, updated, { token });
    trackTime(elapsed, put);
    if (put.status === 403) invalidateToken();
    const putBody = json<Booking>(put);
    check(put, {
      'actualizar: status 200': (r) => r.status === 200,
      'actualizar: aplica el nuevo precio': () => putBody?.totalprice === updated.totalprice,
    });

    const patch = request(
      'PATCH',
      path,
      Endpoint.patch,
      { additionalneeds: 'Late checkout' },
      { token },
    );
    trackTime(elapsed, patch);
    const patchBody = json<Booking>(patch);
    check(patch, {
      'parchar: status 200': (r) => r.status === 200,
      'parchar: cambia solo el campo enviado': () =>
        patchBody?.additionalneeds === 'Late checkout' &&
        patchBody.totalprice === updated.totalprice,
    });
  });
  think();

  group('04 cancelar reserva', () => {
    // Particularidad de Restful Booker: DELETE correcto responde 201 Created (no 200 ni 204).
    const del = request('DELETE', path, Endpoint.remove, undefined, {
      token,
      expectedStatuses: [201],
    });
    trackTime(elapsed, del);
    check(del, { 'borrar: status 201': (r) => r.status === 201 });

    // Aquí el 404 es el resultado correcto: se marca como esperado para no contarlo en
    // http_req_failed, y el check confirma que la reserva realmente desapareció.
    const gone = request('GET', path, Endpoint.readDeleted, undefined, { expectedStatuses: [404] });
    trackTime(elapsed, gone);
    check(gone, { 'borrar: la reserva ya no existe (404)': (r) => r.status === 404 });
  });

  flowServerTime.add(elapsed.ms);
}
