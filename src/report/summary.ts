/**
 * handleSummary: al terminar la prueba genera, a partir del resumen de k6,
 *   - reports/<tipo>-summary.json  instantánea compacta que usa scripts/compare-baseline.ts
 *   - reports/<tipo>-summary.md    resumen para la pestaña "Summary" de GitHub Actions
 *   - reports/<tipo>-report.html   reporte autocontenido (artefacto de CI / GitHub Pages)
 *   - stdout                        resumen legible en consola
 *
 * No depende de librerías remotas (jslib): funciona sin red y con cualquier versión de k6.
 */
import exec from 'k6/execution';
import { config } from '../lib/config.ts';
import { SLO, type TestType } from '../lib/slo.ts';
import { renderHtml } from './html.ts';

interface MetricData {
  type: 'counter' | 'gauge' | 'rate' | 'trend';
  contains: 'time' | 'data' | 'default';
  values: Record<string, number>;
  thresholds?: Record<string, { ok: boolean }>;
}

interface CheckData {
  name: string;
  passes: number;
  fails: number;
}

interface GroupData {
  name: string;
  groups: GroupData[];
  checks: CheckData[];
}

export interface SummaryData {
  metrics: Record<string, MetricData | undefined>;
  root_group: GroupData;
  state: { testRunDurationMs: number };
}

export interface LatencyStats {
  avg: number;
  med: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  count: number;
}

export interface ThresholdResult {
  metric: string;
  expression: string;
  ok: boolean;
}

/** Formato estable de la instantánea: es el contrato con compare-baseline.ts. */
export interface Snapshot {
  schemaVersion: 1;
  testType: TestType;
  testId: string;
  finishedAt: string;
  durationSeconds: number;
  gitSha: string | null;
  config: { baseUrl: string; timeScale: number; loadScale: number; thinkTime: number };
  thresholdsPassed: boolean;
  thresholds: ThresholdResult[];
  totals: {
    requests: number;
    requestsPerSecond: number;
    iterations: number;
    droppedIterations: number;
    errorRate: number;
    checksRate: number;
  };
  latency: LatencyStats;
  endpoints: Record<string, LatencyStats>;
  checks: CheckData[];
}

const round = (n: number | undefined, digits = 2): number =>
  n === undefined || !Number.isFinite(n) ? 0 : Number(n.toFixed(digits));

function latencyOf(metric: MetricData | undefined): LatencyStats {
  const v = metric?.values ?? {};
  return {
    avg: round(v.avg),
    med: round(v.med),
    p90: round(v['p(90)']),
    p95: round(v['p(95)']),
    p99: round(v['p(99)']),
    max: round(v.max),
    count: round(v.count, 0),
  };
}

function collectChecks(group: GroupData, out: CheckData[] = []): CheckData[] {
  for (const c of group.checks) out.push({ name: c.name, passes: c.passes, fails: c.fails });
  for (const g of group.groups) collectChecks(g, out);
  return out;
}

function currentTestId(type: TestType): string {
  // exec.test.options devuelve las opciones consolidadas de la ejecución, incluido el testid
  // que se generó en scenarios.ts; si no está disponible se usa TEST_ID o el tipo.
  try {
    const tags = exec.test.options.tags as Record<string, string> | undefined;
    if (tags?.testid) return tags.testid;
  } catch {
    // handleSummary en versiones de k6 sin acceso a exec.test.options
  }
  return config.testId || type;
}

export function buildSnapshot(type: TestType, data: SummaryData): Snapshot {
  const thresholds: ThresholdResult[] = [];
  const endpoints: Record<string, LatencyStats> = {};

  for (const [name, metric] of Object.entries(data.metrics)) {
    if (!metric) continue;
    for (const [expression, result] of Object.entries(metric.thresholds ?? {})) {
      thresholds.push({ metric: name, expression, ok: result.ok });
    }
    const endpoint = /^http_req_duration\{name:(.+)\}$/.exec(name)?.[1];
    if (endpoint) endpoints[endpoint] = latencyOf(metric);
  }
  thresholds.sort((a, b) => Number(a.ok) - Number(b.ok) || a.metric.localeCompare(b.metric));

  const m = data.metrics;
  return {
    schemaVersion: 1,
    testType: type,
    testId: currentTestId(type),
    finishedAt: new Date().toISOString(),
    durationSeconds: round(data.state.testRunDurationMs / 1000, 1),
    gitSha: __ENV.GITHUB_SHA ?? null,
    config: {
      baseUrl: config.baseUrl,
      timeScale: config.timeScale,
      loadScale: config.loadScale,
      thinkTime: config.thinkTime,
    },
    thresholdsPassed: thresholds.every((t) => t.ok),
    thresholds,
    totals: {
      requests: round(m.http_reqs?.values.count, 0),
      requestsPerSecond: round(m.http_reqs?.values.rate),
      iterations: round(m.iterations?.values.count, 0),
      droppedIterations: round(m.dropped_iterations?.values.count, 0),
      errorRate: round(m.http_req_failed?.values.rate, 4),
      checksRate: round(m.checks?.values.rate, 4),
    },
    latency: latencyOf(m.http_req_duration),
    endpoints,
    checks: collectChecks(data.root_group),
  };
}

const pct = (rate: number): string => `${(rate * 100).toFixed(2)} %`;
const ms = (value: number): string => `${value.toFixed(1)} ms`;

function sloFor(endpoint: string): number | undefined {
  return (SLO.endpointP95 as Record<string, number>)[endpoint];
}

export function renderText(s: Snapshot): string {
  const lines: string[] = [];
  const bar = '─'.repeat(78);
  lines.push('', bar);
  lines.push(
    ` ${s.testType.toUpperCase()}  ·  ${s.thresholdsPassed ? '✓ SLOs CUMPLIDOS' : '✗ SLOs INCUMPLIDOS'}  ·  ` +
      `${s.durationSeconds}s  ·  testid=${s.testId}`,
  );
  lines.push(bar);
  lines.push(
    ` peticiones ${s.totals.requests} (${s.totals.requestsPerSecond}/s)   iteraciones ${s.totals.iterations}` +
      `   descartadas ${s.totals.droppedIterations}`,
  );
  lines.push(
    ` errores ${pct(s.totals.errorRate)}   checks ${pct(s.totals.checksRate)}   ` +
      `p95 ${ms(s.latency.p95)}   p99 ${ms(s.latency.p99)}   máx ${ms(s.latency.max)}`,
  );
  lines.push('', ' Endpoint                    n      avg      p95      p99   SLO p95');
  for (const [name, e] of Object.entries(s.endpoints).sort()) {
    lines.push(
      ` ${name.padEnd(24)} ${String(e.count).padStart(5)} ${e.avg.toFixed(1).padStart(8)} ` +
        `${e.p95.toFixed(1).padStart(8)} ${e.p99.toFixed(1).padStart(8)} ${String(sloFor(name) ?? '-').padStart(9)}`,
    );
  }
  lines.push('', ' Thresholds');
  for (const t of s.thresholds) {
    lines.push(`  ${t.ok ? '✓' : '✗'} ${t.metric}  ${t.expression}`);
  }
  const failedChecks = s.checks.filter((c) => c.fails > 0);
  if (failedChecks.length > 0) {
    lines.push('', ' Checks con fallos');
    for (const c of failedChecks) lines.push(`  ✗ ${c.name}: ${c.fails} de ${c.passes + c.fails}`);
  }
  lines.push(bar, '');
  return lines.join('\n');
}

export function renderMarkdown(s: Snapshot): string {
  const failed = s.thresholds.filter((t) => !t.ok);
  const out: string[] = [
    `### ${s.thresholdsPassed ? '✅' : '❌'} k6 ${s.testType} — ${s.thresholdsPassed ? 'SLOs cumplidos' : `${failed.length} threshold(s) incumplidos`}`,
    '',
    `| Peticiones | req/s | Errores | Checks | p95 | p99 | Duración |`,
    `|---:|---:|---:|---:|---:|---:|---:|`,
    `| ${s.totals.requests} | ${s.totals.requestsPerSecond} | ${pct(s.totals.errorRate)} | ${pct(s.totals.checksRate)} | ${ms(s.latency.p95)} | ${ms(s.latency.p99)} | ${s.durationSeconds}s |`,
    '',
  ];
  if (failed.length > 0) {
    out.push('**Thresholds incumplidos**', '');
    for (const t of failed) out.push(`- \`${t.metric}\` → \`${t.expression}\``);
    out.push('');
  }
  out.push('| Endpoint | n | p95 | p99 | SLO p95 |', '|---|---:|---:|---:|---:|');
  for (const [name, e] of Object.entries(s.endpoints).sort()) {
    const slo = sloFor(name);
    const flag = slo !== undefined && e.p95 >= slo ? ' ⚠️' : '';
    out.push(`| ${name} | ${e.count} | ${ms(e.p95)}${flag} | ${ms(e.p99)} | ${slo ?? '-'} ms |`);
  }
  out.push(
    '',
    `<sub>testid \`${s.testId}\` · TIME_SCALE=${s.config.timeScale} · LOAD_SCALE=${s.config.loadScale}</sub>`,
    '',
  );
  return out.join('\n');
}

export function makeHandleSummary(type: TestType) {
  return (data: SummaryData): Record<string, string> => {
    const snapshot = buildSnapshot(type, data);
    const dir = config.reportDir;
    return {
      stdout: renderText(snapshot),
      [`${dir}/${type}-summary.json`]: `${JSON.stringify(snapshot, null, 2)}\n`,
      [`${dir}/${type}-summary.md`]: renderMarkdown(snapshot),
      [`${dir}/${type}-report.html`]: renderHtml(snapshot),
    };
  };
}
