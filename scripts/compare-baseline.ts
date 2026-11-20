/**
 * Compara una ejecución con la línea base versionada y falla si hay regresión de latencia o errores.
 *
 *   node scripts/compare-baseline.ts --type load              # reports/load-summary.json vs baselines/load.json
 *   node scripts/compare-baseline.ts --type load --update     # promueve la ejecución a línea base
 *   node scripts/compare-baseline.ts --current a.json --baseline b.json --tolerance 0.15
 *
 * Criterio: una métrica de latencia empeora si supera la línea base en más de --tolerance (20 %)
 * Y en más de --min-delta-ms (5 ms). La segunda condición evita falsos positivos con tiempos muy
 * bajos: pasar de 3 ms a 4 ms es +33 % pero es ruido. La tasa de error empeora si sube más de
 * --max-error-delta (0,5 puntos porcentuales).
 *
 * Códigos de salida: 0 sin regresión (o sin línea base comparable), 1 regresión, 2 error de uso.
 * Si existe GITHUB_STEP_SUMMARY, agrega la tabla al resumen del job.
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Subconjunto de la instantánea de src/report/summary.ts que usa la comparación. */
export interface LatencyStats {
  p95: number;
  p99: number;
  count: number;
}

export interface Snapshot {
  schemaVersion: number;
  testType: string;
  testId: string;
  finishedAt: string;
  config: { timeScale: number; loadScale: number; thinkTime: number };
  totals: { errorRate: number; requestsPerSecond: number };
  latency: LatencyStats;
  endpoints: Record<string, LatencyStats>;
}

export interface CompareOptions {
  tolerance: number;
  minDeltaMs: number;
  maxErrorDelta: number;
}

export type RowStatus = 'ok' | 'regression' | 'improvement' | 'new';

export interface Row {
  metric: string;
  baseline: number | null;
  current: number;
  unit: 'ms' | '%';
  status: RowStatus;
}

export interface Comparison {
  comparable: boolean;
  reason?: string;
  rows: Row[];
  regressions: Row[];
}

export const DEFAULT_OPTIONS: CompareOptions = {
  tolerance: 0.2,
  minDeltaMs: 5,
  maxErrorDelta: 0.005,
};

function latencyRow(
  metric: string,
  baseline: number | undefined,
  current: number,
  o: CompareOptions,
): Row {
  if (baseline === undefined) return { metric, baseline: null, current, unit: 'ms', status: 'new' };
  const delta = current - baseline;
  let status: RowStatus = 'ok';
  if (delta > baseline * o.tolerance && delta >= o.minDeltaMs) status = 'regression';
  else if (-delta > baseline * o.tolerance && -delta >= o.minDeltaMs) status = 'improvement';
  return { metric, baseline, current, unit: 'ms', status };
}

export function compare(
  baseline: Snapshot,
  current: Snapshot,
  options: CompareOptions = DEFAULT_OPTIONS,
): Comparison {
  // Comparar ejecuciones con distinto perfil (otra duración o tasa) no tiene sentido estadístico.
  const differs: string[] = [];
  if (baseline.testType !== current.testType) differs.push('tipo de prueba');
  if (baseline.config.timeScale !== current.config.timeScale) differs.push('TIME_SCALE');
  if (baseline.config.loadScale !== current.config.loadScale) differs.push('LOAD_SCALE');
  if (baseline.config.thinkTime !== current.config.thinkTime) differs.push('THINK_TIME');
  if (differs.length > 0) {
    return {
      comparable: false,
      reason: `la ejecución usa otro perfil que la línea base (${differs.join(', ')})`,
      rows: [],
      regressions: [],
    };
  }

  const rows: Row[] = [
    latencyRow('p95 global', baseline.latency.p95, current.latency.p95, options),
    latencyRow('p99 global', baseline.latency.p99, current.latency.p99, options),
  ];
  for (const [name, stats] of Object.entries(current.endpoints).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    rows.push(latencyRow(`p95 ${name}`, baseline.endpoints[name]?.p95, stats.p95, options));
  }

  const errDelta = current.totals.errorRate - baseline.totals.errorRate;
  rows.push({
    metric: 'tasa de error',
    baseline: baseline.totals.errorRate,
    current: current.totals.errorRate,
    unit: '%',
    status:
      errDelta > options.maxErrorDelta
        ? 'regression'
        : errDelta < -options.maxErrorDelta
          ? 'improvement'
          : 'ok',
  });

  return { comparable: true, rows, regressions: rows.filter((r) => r.status === 'regression') };
}

const ICON: Record<RowStatus, string> = {
  ok: '✅',
  regression: '❌',
  improvement: '🟢',
  new: '🆕',
};

function fmt(value: number | null, unit: Row['unit']): string {
  if (value === null) return '—';
  return unit === '%' ? `${(value * 100).toFixed(2)} %` : `${value.toFixed(1)} ms`;
}

function change(row: Row): string {
  if (row.baseline === null) return 'nuevo';
  if (row.unit === '%') return `${((row.current - row.baseline) * 100).toFixed(2)} pp`;
  if (row.baseline === 0) return '—';
  const pct = ((row.current - row.baseline) / row.baseline) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)} %`;
}

export function toMarkdown(
  result: Comparison,
  baseline: Snapshot,
  options: CompareOptions,
): string {
  if (!result.comparable) {
    return `### ⚠️ Línea base: comparación omitida\n\nNo se compara porque ${result.reason}.\n`;
  }
  const head = result.regressions.length
    ? `### ❌ Línea base: ${result.regressions.length} regresión(es)`
    : '### ✅ Línea base: sin regresiones';
  const lines = [
    head,
    '',
    `Contra \`${baseline.testId}\` (${baseline.finishedAt}). Tolerancia ${options.tolerance * 100} % y ` +
      `${options.minDeltaMs} ms para latencia; ${options.maxErrorDelta * 100} pp para errores.`,
    '',
    '| | Métrica | Línea base | Actual | Cambio |',
    '|---|---|---:|---:|---:|',
    ...result.rows.map(
      (r) =>
        `| ${ICON[r.status]} | ${r.metric} | ${fmt(r.baseline, r.unit)} | ${fmt(r.current, r.unit)} | ${change(r)} |`,
    ),
    '',
  ];
  return lines.join('\n');
}

function readSnapshot(path: string): Snapshot {
  const data = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
  if (data.schemaVersion !== 1)
    throw new Error(`${path}: schemaVersion ${data.schemaVersion} no soportado`);
  return data;
}

function report(markdown: string): void {
  console.log(markdown);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${markdown}\n`);
}

export function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      type: { type: 'string' },
      current: { type: 'string' },
      baseline: { type: 'string' },
      tolerance: { type: 'string', default: String(DEFAULT_OPTIONS.tolerance) },
      'min-delta-ms': { type: 'string', default: String(DEFAULT_OPTIONS.minDeltaMs) },
      'max-error-delta': { type: 'string', default: String(DEFAULT_OPTIONS.maxErrorDelta) },
      update: { type: 'boolean', default: false },
    },
  });

  const currentPath =
    values.current ?? (values.type ? `reports/${values.type}-summary.json` : undefined);
  const baselinePath =
    values.baseline ?? (values.type ? `baselines/${values.type}.json` : undefined);
  if (!currentPath || !baselinePath) {
    console.error(
      'Uso: compare-baseline.ts --type <load|soak|…> | --current <json> --baseline <json> [--update]',
    );
    return 2;
  }
  if (!existsSync(currentPath)) {
    console.error(`No existe ${currentPath}: ¿terminó k6 y generó el resumen?`);
    return 2;
  }

  if (values.update) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    copyFileSync(currentPath, baselinePath);
    console.log(
      `Línea base actualizada: ${currentPath} → ${baselinePath}. Revisa y versiona el archivo.`,
    );
    return 0;
  }

  if (!existsSync(baselinePath)) {
    report(
      `### ⚠️ Línea base: no existe \`${baselinePath}\`\n\n` +
        'Se omite la comparación. Para crearla, descarga el artefacto de una ejecución en CI y ' +
        `guarda su \`*-summary.json\` como \`${baselinePath}\` (ver README → Línea base).\n`,
    );
    return 0;
  }

  const options: CompareOptions = {
    tolerance: Number(values.tolerance),
    minDeltaMs: Number(values['min-delta-ms']),
    maxErrorDelta: Number(values['max-error-delta']),
  };
  const baseline = readSnapshot(baselinePath);
  const result = compare(baseline, readSnapshot(currentPath), options);
  report(toMarkdown(result, baseline, options));
  return result.regressions.length > 0 ? 1 : 0;
}

// Solo se ejecuta como CLI, no al importarlo desde las pruebas.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
