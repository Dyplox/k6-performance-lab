/**
 * Flujo "explorar": tráfico de solo lectura, que en un sistema de reservas es la mayoría.
 *
 *   listar reservas → abrir el detalle de una al azar
 *
 * Se combina con el flujo de reservas en las pruebas (por defecto 70 % / 30 %) para que la
 * carga se parezca a un uso real y no solo a escrituras.
 */
import { check, group } from 'k6';
import { Endpoint, json, request } from '../lib/http.ts';
import { think } from '../lib/sut.ts';

export function browseFlow(): void {
  let ids: { bookingid: number }[] | undefined;

  group('explorar: listar', () => {
    const res = request('GET', '/booking', Endpoint.list);
    ids = json<{ bookingid: number }[]>(res);
    check(res, {
      'listar: status 200': (r) => r.status === 200,
      'listar: devuelve un arreglo': () => Array.isArray(ids),
    });
  });

  if (!ids || ids.length === 0) return;
  think();

  group('explorar: detalle', () => {
    const pick = ids?.[Math.floor(Math.random() * (ids?.length ?? 1))];
    if (!pick) return;
    // Otro VU puede borrar esa reserva entre el listado y el detalle (el flujo CRUD borra lo que
    // crea): en este paso un 404 es una carrera válida, no un error del servidor.
    const res = request('GET', `/booking/${pick.bookingid}`, Endpoint.detail, undefined, {
      expectedStatuses: [200, 404],
    });
    check(res, {
      'detalle: status 200 o 404 por carrera': (r) => r.status === 200 || r.status === 404,
      'detalle: trae nombre si existe': (r) =>
        r.status === 404 || typeof json<{ firstname?: string }>(r)?.firstname === 'string',
    });
  });
}
