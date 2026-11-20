/**
 * Configuración del laboratorio leída de variables de entorno (`k6 run -e CLAVE=valor` o `export`).
 *
 * La duración y la intensidad de cada prueba no están fijas en el código: los perfiles se
 * definen cortos y se escalan con TIME_SCALE y LOAD_SCALE. Así la misma prueba sirve para
 * CI (minutos) y para una ejecución real (horas) sin tocar código.
 */

function envString(name: string, fallback: string): string {
  const value = __ENV[name];
  return value !== undefined && value !== '' ? value : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = __ENV[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`La variable ${name} debe ser un número positivo y vale "${raw}"`);
  }
  return value;
}

export const config = {
  /** URL del sistema bajo prueba, sin "/" final. */
  baseUrl: envString('BASE_URL', 'http://localhost:3001').replace(/\/+$/, ''),
  /** Mismos nombres de variables que RESTFUL_BOOKERING. */
  username: envString('RESTFUL_BOOKER_USUARIO', 'admin'),
  password: envString('RESTFUL_BOOKER_CLAVE', 'password123'),
  /** Multiplica la duración de todas las etapas: 1 = perfil corto, 10 = diez veces más largo. */
  timeScale: envNumber('TIME_SCALE', 1),
  /** Multiplica la tasa de llegada (iteraciones/s) de todos los perfiles. */
  loadScale: envNumber('LOAD_SCALE', 1),
  /** Pausa entre pasos de un flujo, en segundos (simula a una persona). 0 la desactiva. */
  thinkTime: __ENV.THINK_TIME === '0' ? 0 : envNumber('THINK_TIME', 1),
  /** Carpeta de reportes de handleSummary. */
  reportDir: envString('REPORT_DIR', 'reports'),
  /** Identificador de la ejecución: etiqueta "testid" en Prometheus/Grafana y en el resumen. */
  testId: envString('TEST_ID', ''),
};

/** Escala una duración en segundos con TIME_SCALE y la devuelve en el formato de k6 ("90s"). */
export function duration(seconds: number): string {
  return `${Math.max(1, Math.round(seconds * config.timeScale))}s`;
}

/** Escala una tasa de llegada con LOAD_SCALE (mínimo 1 iteración por unidad de tiempo). */
export function rate(iterationsPerSecond: number): number {
  return Math.max(1, Math.round(iterationsPerSecond * config.loadScale));
}
