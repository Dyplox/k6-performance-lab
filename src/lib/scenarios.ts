/**
 * Perfiles de carga de cada tipo de prueba y construcción de `options`.
 *
 * Cada prueba combina dos escenarios que corren en paralelo:
 *   - browse: tráfico de lectura (70 % de las iteraciones)
 *   - book:   ciclo CRUD completo de una reserva (30 %)
 *
 * Salvo smoke, se usa `ramping-arrival-rate` (modelo abierto): k6 inicia iteraciones a una tasa
 * fija aunque el servidor se ponga lento, como pasa con usuarios reales. Con un modelo cerrado
 * (VUs fijos), si el servidor se degrada los VUs esperan y la carga baja sola, lo que oculta el
 * problema que se quiere medir.
 *
 * Las duraciones y tasas por defecto son cortas para no gastar minutos de CI; se escalan con
 * TIME_SCALE y LOAD_SCALE (ver config.ts).
 */
import type { Options, Scenario } from 'k6/options';
import { config, duration, rate } from './config.ts';
import { thresholdsFor, type TestType } from './slo.ts';

const BROWSE_SHARE = 0.7;

/** Etapa de un perfil: duración en segundos y tasa total objetivo en iteraciones/s. */
interface Stage {
  seconds: number;
  target: number;
}

interface Profile {
  description: string;
  stages: Stage[];
  /** VUs máximos que k6 puede usar para sostener la tasa (se escala con LOAD_SCALE). */
  maxVUs: number;
}

export const PROFILES: Record<Exclude<TestType, 'smoke'>, Profile> = {
  // Carga esperada en un día normal: subir, sostener, bajar.
  load: {
    description: 'Carga nominal sostenida',
    stages: [
      { seconds: 30, target: 10 },
      { seconds: 60, target: 10 },
      { seconds: 15, target: 0 },
    ],
    maxVUs: 60,
  },
  // Escalones por encima de lo nominal para encontrar dónde empieza a degradarse.
  stress: {
    description: 'Escalones hasta 4× la carga nominal',
    stages: [
      { seconds: 20, target: 10 },
      { seconds: 30, target: 20 },
      { seconds: 30, target: 30 },
      { seconds: 30, target: 40 },
      { seconds: 15, target: 0 },
    ],
    maxVUs: 200,
  },
  // Subida brusca y caída: ¿aguanta el pico y se recupera después?
  spike: {
    description: 'Pico repentino de 20× y recuperación',
    stages: [
      { seconds: 10, target: 2 },
      { seconds: 10, target: 2 },
      { seconds: 5, target: 40 },
      { seconds: 30, target: 40 },
      { seconds: 5, target: 2 },
      { seconds: 30, target: 2 },
      { seconds: 5, target: 0 },
    ],
    maxVUs: 200,
  },
  // Carga moderada por mucho tiempo: fugas de memoria, crecimiento de datos, degradación lenta.
  // 5 min por defecto; con TIME_SCALE=48 son 4 horas.
  soak: {
    description: 'Carga moderada prolongada',
    stages: [
      { seconds: 15, target: 5 },
      { seconds: 270, target: 5 },
      { seconds: 15, target: 0 },
    ],
    maxVUs: 60,
  },
};

function arrivalRate(exec: 'browse' | 'book', share: number, profile: Profile): Scenario {
  const maxVUs = Math.ceil(profile.maxVUs * config.loadScale * share);
  return {
    executor: 'ramping-arrival-rate',
    exec,
    startRate: 0,
    timeUnit: '1s',
    // Crear VUs a mitad de prueba cuesta tiempo y provoca iteraciones descartadas: se reserva la mitad.
    preAllocatedVUs: Math.max(2, Math.ceil(maxVUs / 2)),
    maxVUs,
    gracefulStop: '30s',
    stages: profile.stages.map((s) => ({
      duration: duration(s.seconds),
      target: s.target === 0 ? 0 : rate(s.target * share),
    })),
  };
}

function scenariosFor(type: TestType): Record<string, Scenario> {
  if (type === 'smoke') {
    // Smoke valida que el flujo funciona y cumple los SLOs con carga mínima: 1 VU por flujo.
    const smoke = (exec: string): Scenario => ({
      executor: 'constant-vus',
      exec,
      vus: 1,
      duration: duration(30),
      gracefulStop: '10s',
    });
    return { browse: smoke('browse'), book: smoke('book') };
  }
  const profile = PROFILES[type];
  return {
    browse: arrivalRate('browse', BROWSE_SHARE, profile),
    book: arrivalRate('book', 1 - BROWSE_SHARE, profile),
  };
}

/** Etiquetas de sistema por defecto de k6 menos `url`: cada id generaría una serie nueva. */
const SYSTEM_TAGS = [
  'proto',
  'subproto',
  'status',
  'method',
  'name',
  'group',
  'check',
  'error',
  'error_code',
  'tls_version',
  'scenario',
  'expected_response',
];

function defaultTestId(type: TestType): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${type}-${stamp}`;
}

export function buildOptions(type: TestType): Options {
  return {
    scenarios: scenariosFor(type),
    thresholds: thresholdsFor(type),
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
    systemTags: SYSTEM_TAGS,
    // test_type y testid viajan como etiquetas a Prometheus para filtrar en Grafana.
    tags: { test_type: type, testid: config.testId || defaultTestId(type) },
    setupTimeout: '30s',
  };
}
