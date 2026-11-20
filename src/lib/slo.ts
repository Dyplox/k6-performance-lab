/**
 * SLOs del servicio expresados como thresholds de k6.
 *
 * Un threshold incumplido hace que k6 termine con código 99, y eso falla el job de CI: el
 * rendimiento se trata como un criterio de aceptación más, no como un reporte que alguien mira.
 *
 * Los valores aplican al SUT en Docker con 1 CPU (ver docker-compose.yml) y a runners de GitHub.
 * La justificación de cada número está en el README ("SLOs").
 */
import type { Options } from 'k6/options';
import { Endpoint, type EndpointName } from './http.ts';

type Thresholds = NonNullable<Options['thresholds']>;

export type TestType = 'smoke' | 'load' | 'stress' | 'spike' | 'soak';

export const SLO = {
  /** Latencia global de todas las peticiones, en ms. */
  latency: { p95: 500, p99: 1000 },
  /** Porcentaje máximo de peticiones fallidas (status inesperado o error de red). */
  errorRate: 0.01,
  /** Porcentaje mínimo de checks que deben pasar. */
  checks: 0.99,
  /** p95 por endpoint, en ms. Las lecturas por id son más exigentes que las escrituras. */
  endpointP95: {
    [Endpoint.auth]: 400,
    [Endpoint.list]: 400,
    [Endpoint.detail]: 300,
    [Endpoint.search]: 400,
    [Endpoint.create]: 400,
    [Endpoint.read]: 300,
    [Endpoint.update]: 400,
    [Endpoint.patch]: 400,
    [Endpoint.remove]: 400,
    [Endpoint.readDeleted]: 300,
  } satisfies Partial<Record<EndpointName, number>>,
  /** p95 del tiempo de servidor de un flujo CRUD completo (7 peticiones), en ms. */
  crudFlowP95: 2000,
} as const;

/**
 * Estrés y picos buscan el punto de quiebre: se espera degradación, así que la latencia se
 * relaja (×3) y la prueba se aborta si el sistema deja de responder (> 5 % de errores),
 * en lugar de seguir martillando un servicio caído.
 */
const LATENCY_FACTOR: Record<TestType, number> = {
  smoke: 1,
  load: 1,
  soak: 1,
  stress: 3,
  spike: 3,
};

/** Endpoints que todo flujo debe ejercitar: si alguno no recibe tráfico, la prueba no es válida. */
const MUST_BE_EXERCISED: EndpointName[] = [
  Endpoint.list,
  Endpoint.create,
  Endpoint.read,
  Endpoint.search,
  Endpoint.update,
  Endpoint.patch,
  Endpoint.remove,
  Endpoint.readDeleted,
];

export function thresholdsFor(type: TestType): Thresholds {
  const factor = LATENCY_FACTOR[type];
  const breaking = type === 'stress' || type === 'spike';
  const ms = (value: number) => Math.round(value * factor);

  const thresholds: Thresholds = {
    http_req_duration: [`p(95)<${ms(SLO.latency.p95)}`, `p(99)<${ms(SLO.latency.p99)}`],
    http_req_failed: breaking
      ? [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '20s' }]
      : [`rate<${SLO.errorRate}`],
    checks: [`rate>${breaking ? 0.95 : SLO.checks}`],
    crud_flow_server_time: [`p(95)<${ms(SLO.crudFlowP95)}`],
  };

  for (const [name, p95] of Object.entries(SLO.endpointP95)) {
    thresholds[`http_req_duration{name:${name}}`] = [`p(95)<${ms(p95)}`];
  }
  for (const name of MUST_BE_EXERCISED) {
    thresholds[`http_reqs{name:${name}}`] = ['count>0'];
  }

  // Con ramping-arrival-rate, una iteración descartada significa que k6 no tuvo VUs libres para
  // mantener la tasa: la carga real fue menor a la planeada y el resultado no es confiable.
  if (type === 'load' || type === 'soak') {
    thresholds.dropped_iterations = ['count<10'];
  }

  return thresholds;
}
