/**
 * Reporte HTML autocontenido (sin CSS ni JS externos) a partir de la instantánea del resumen.
 */
import { SLO } from '../lib/slo.ts';
import type { Snapshot } from './summary.ts';

const escape = (value: unknown): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const pct = (rate: number): string => `${(rate * 100).toFixed(2)} %`;
const ms = (value: number): string => `${value.toFixed(1)} ms`;

function card(label: string, value: string, bad = false): string {
  return `<div class="card${bad ? ' bad' : ''}"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
}

export function renderHtml(s: Snapshot): string {
  const endpointSlo = SLO.endpointP95 as Record<string, number>;
  const endpointRows = Object.entries(s.endpoints)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, e]) => {
      const slo = endpointSlo[name];
      const over = slo !== undefined && e.p95 >= slo;
      // Barra: p95 como porcentaje del SLO (tope 100 %), para ver el margen de un vistazo.
      const width = slo ? Math.min(100, (e.p95 / slo) * 100) : 0;
      return `<tr><td><code>${escape(name)}</code></td><td>${e.count}</td><td>${ms(e.avg)}</td>
        <td class="${over ? 'ko' : ''}">${ms(e.p95)}</td><td>${ms(e.p99)}</td><td>${ms(e.max)}</td>
        <td>${slo ?? '-'} ms<div class="bar"><i style="width:${width.toFixed(0)}%" class="${over ? 'ko' : ''}"></i></div></td></tr>`;
    })
    .join('');

  const thresholdRows = s.thresholds
    .map(
      (t) =>
        `<tr><td class="${t.ok ? 'ok' : 'ko'}">${t.ok ? '✓' : '✗'}</td><td><code>${escape(t.metric)}</code></td><td><code>${escape(t.expression)}</code></td></tr>`,
    )
    .join('');

  const checkRows = s.checks
    .map((c) => {
      const total = c.passes + c.fails;
      return `<tr><td class="${c.fails === 0 ? 'ok' : 'ko'}">${c.fails === 0 ? '✓' : '✗'}</td><td>${escape(c.name)}</td>
        <td>${c.passes}/${total}</td><td>${total ? pct(c.passes / total) : '-'}</td></tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>k6 ${escape(s.testType)} · ${s.thresholdsPassed ? 'OK' : 'FALLÓ'}</title>
<style>
  :root { --ok:#1a7f37; --ko:#cf222e; --muted:#59636e; --line:#d1d9e0; --bg:#f6f8fa; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; color: #1f2328; }
  main { max-width: 1100px; margin: 0 auto; padding: 32px 24px 48px; }
  header { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 24px; margin: 0; }
  h2 { font-size: 16px; margin: 32px 0 8px; }
  .badge { padding: 4px 12px; border-radius: 999px; color: #fff; font-weight: 600; }
  .badge.ok { background: var(--ok); } .badge.ko { background: var(--ko); }
  .meta { color: var(--muted); margin: 4px 0 0; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 24px; }
  .card { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
  .card span { display: block; color: var(--muted); font-size: 12px; }
  .card strong { font-size: 20px; }
  .card.bad strong { color: var(--ko); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; }
  td.ok { color: var(--ok); font-weight: 700; } td.ko { color: var(--ko); font-weight: 700; }
  .bar { height: 4px; background: var(--line); border-radius: 2px; margin-top: 4px; }
  .bar i { display: block; height: 100%; background: var(--ok); border-radius: 2px; }
  .bar i.ko { background: var(--ko); }
  code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
  footer { margin-top: 32px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body><main>
<header>
  <h1>k6 · ${escape(s.testType)}</h1>
  <span class="badge ${s.thresholdsPassed ? 'ok' : 'ko'}">${s.thresholdsPassed ? 'SLOs cumplidos' : 'SLOs incumplidos'}</span>
</header>
<p class="meta">testid <code>${escape(s.testId)}</code> · ${escape(s.finishedAt)} · ${s.durationSeconds}s
  ${s.gitSha ? ` · commit <code>${escape(s.gitSha.slice(0, 7))}</code>` : ''}</p>

<section class="cards">
  ${card('Peticiones', `${s.totals.requests}`)}
  ${card('Peticiones/s', `${s.totals.requestsPerSecond}`)}
  ${card('Errores', pct(s.totals.errorRate), s.totals.errorRate >= SLO.errorRate)}
  ${card('Checks', pct(s.totals.checksRate), s.totals.checksRate < SLO.checks)}
  ${card('p95', ms(s.latency.p95), s.latency.p95 >= SLO.latency.p95)}
  ${card('p99', ms(s.latency.p99), s.latency.p99 >= SLO.latency.p99)}
  ${card('Iteraciones', `${s.totals.iterations}`)}
  ${card('Descartadas', `${s.totals.droppedIterations}`, s.totals.droppedIterations > 0)}
</section>

<h2>Latencia por endpoint</h2>
<table><thead><tr><th>Endpoint</th><th>n</th><th>avg</th><th>p95</th><th>p99</th><th>máx</th><th>SLO p95</th></tr></thead>
<tbody>${endpointRows}</tbody></table>

<h2>Thresholds (SLOs)</h2>
<table><thead><tr><th></th><th>Métrica</th><th>Condición</th></tr></thead><tbody>${thresholdRows}</tbody></table>

<h2>Checks</h2>
<table><thead><tr><th></th><th>Check</th><th>Pasaron</th><th>%</th></tr></thead><tbody>${checkRows}</tbody></table>

<footer>BASE_URL ${escape(s.config.baseUrl)} · TIME_SCALE=${s.config.timeScale} · LOAD_SCALE=${s.config.loadScale}
  · THINK_TIME=${s.config.thinkTime}s · generado por handleSummary (k6-performance-lab)</footer>
</main></body>
</html>
`;
}
