/**
 * Cliente HTTP del laboratorio: URL base, cabeceras obligatorias y etiqueta `name` por endpoint.
 *
 * - Restful Booker responde 418 si `Accept` no es exactamente "application/json".
 * - La etiqueta `name` agrupa las URLs con id (/booking/123) en un solo endpoint lógico. Sin ella,
 *   cada id sería una serie distinta en las métricas, en los thresholds y en Prometheus.
 */
import http from 'k6/http';
import type { RefinedParams, RefinedResponse, ResponseType } from 'k6/http';
import { config } from './config.ts';

/** Nombres lógicos de los endpoints. Se usan en thresholds, reportes y Grafana. */
export const Endpoint = {
  ping: 'ping',
  auth: 'auth',
  list: 'booking_list',
  detail: 'booking_detail',
  search: 'booking_search',
  create: 'booking_create',
  read: 'booking_read',
  update: 'booking_update',
  patch: 'booking_patch',
  remove: 'booking_delete',
  readDeleted: 'booking_read_deleted',
} as const;

export type EndpointName = (typeof Endpoint)[keyof typeof Endpoint];

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  /** Token de /auth; se envía como cookie, igual que lo documenta la API. */
  token?: string;
  /** Códigos que esta petición considera correctos (afecta a `http_req_failed`). */
  expectedStatuses?: number[];
  query?: Record<string, string>;
}

const jsonHeaders = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

function withQuery(path: string, query?: Record<string, string>): string {
  if (!query) return path;
  const qs = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${path}?${qs}`;
}

export function request(
  method: Method,
  path: string,
  name: EndpointName,
  body?: unknown,
  options: RequestOptions = {},
): RefinedResponse<ResponseType | undefined> {
  const headers: Record<string, string> = { ...jsonHeaders };
  if (options.token) headers.Cookie = `token=${options.token}`;

  const params: RefinedParams<ResponseType> = { headers, tags: { name } };
  if (options.expectedStatuses) {
    params.responseCallback = http.expectedStatuses(...options.expectedStatuses);
  }

  const url = `${config.baseUrl}${withQuery(path, options.query)}`;
  const payload = body === undefined ? null : JSON.stringify(body);
  return http.request(method, url, payload, params);
}

/**
 * Lee el cuerpo como JSON sin lanzar excepción: con 418, 500 o un cuerpo vacío devuelve
 * `undefined` y el check correspondiente falla de forma legible en vez de romper la iteración.
 */
export function json<T>(res: RefinedResponse<ResponseType | undefined>): T | undefined {
  try {
    return res.json() as T;
  } catch {
    return undefined;
  }
}
