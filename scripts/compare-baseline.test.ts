/**
 * Pruebas unitarias de la comparación con la línea base (node:test, sin dependencias).
 * La lógica que decide si un PR o una ejecución programada falla también necesita pruebas.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { compare, type Snapshot } from './compare-baseline.ts';

function snapshot(overrides: {
  p95?: number;
  p99?: number;
  errorRate?: number;
  timeScale?: number;
  endpoints?: Record<string, number>;
}): Snapshot {
  const endpoints = overrides.endpoints ?? { booking_create: 40, booking_read: 20 };
  return {
    schemaVersion: 1,
    testType: 'load',
    testId: 'load-test',
    finishedAt: '2026-11-20T00:00:00.000Z',
    config: { timeScale: overrides.timeScale ?? 1, loadScale: 1, thinkTime: 1 },
    totals: { errorRate: overrides.errorRate ?? 0, requestsPerSecond: 25 },
    latency: { p95: overrides.p95 ?? 50, p99: overrides.p99 ?? 80, count: 1000 },
    endpoints: Object.fromEntries(
      Object.entries(endpoints).map(([name, p95]) => [name, { p95, p99: p95 * 1.5, count: 100 }]),
    ),
  };
}

const statusOf = (rows: ReturnType<typeof compare>['rows'], metric: string) =>
  rows.find((r) => r.metric === metric)?.status;

describe('compare', () => {
  it('no marca regresión si los cambios están dentro de la tolerancia', () => {
    const result = compare(snapshot({}), snapshot({ p95: 58, p99: 90 }));
    assert.equal(result.comparable, true);
    assert.deepEqual(result.regressions, []);
  });

  it('detecta una regresión de p95 que supera tolerancia y delta mínimo', () => {
    const result = compare(snapshot({}), snapshot({ p95: 75 }));
    assert.equal(statusOf(result.rows, 'p95 global'), 'regression');
    assert.equal(result.regressions.length, 1);
  });

  it('ignora cambios relativos grandes pero absolutos mínimos (ruido en tiempos bajos)', () => {
    const base = snapshot({ endpoints: { booking_read: 3 } });
    const result = compare(base, snapshot({ endpoints: { booking_read: 6 } }));
    assert.equal(statusOf(result.rows, 'p95 booking_read'), 'ok');
  });

  it('detecta regresión por endpoint aunque la latencia global no cambie', () => {
    const result = compare(
      snapshot({}),
      snapshot({ endpoints: { booking_create: 90, booking_read: 20 } }),
    );
    assert.equal(statusOf(result.rows, 'p95 booking_create'), 'regression');
    assert.equal(statusOf(result.rows, 'p95 global'), 'ok');
  });

  it('detecta subida de la tasa de error por encima de 0,5 pp', () => {
    const result = compare(snapshot({ errorRate: 0.001 }), snapshot({ errorRate: 0.02 }));
    assert.equal(statusOf(result.rows, 'tasa de error'), 'regression');
  });

  it('reporta mejoras sin fallar', () => {
    const result = compare(snapshot({}), snapshot({ p95: 30 }));
    assert.equal(statusOf(result.rows, 'p95 global'), 'improvement');
    assert.deepEqual(result.regressions, []);
  });

  it('marca como nuevo un endpoint que no está en la línea base', () => {
    const result = compare(
      snapshot({}),
      snapshot({ endpoints: { booking_create: 40, booking_read: 20, auth: 15 } }),
    );
    assert.equal(statusOf(result.rows, 'p95 auth'), 'new');
    assert.deepEqual(result.regressions, []);
  });

  it('no compara ejecuciones con distinto perfil', () => {
    const result = compare(snapshot({}), snapshot({ p95: 500, timeScale: 10 }));
    assert.equal(result.comparable, false);
    assert.match(result.reason ?? '', /TIME_SCALE/);
    assert.deepEqual(result.regressions, []);
  });
});

describe('CLI', () => {
  const script = join(import.meta.dirname, 'compare-baseline.ts');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
    });

  const dir = mkdtempSync(join(tmpdir(), 'baseline-'));
  const base = join(dir, 'base.json');
  const ok = join(dir, 'ok.json');
  const slow = join(dir, 'slow.json');
  writeFileSync(base, JSON.stringify(snapshot({})));
  writeFileSync(ok, JSON.stringify(snapshot({ p95: 52 })));
  writeFileSync(slow, JSON.stringify(snapshot({ p95: 200 })));

  it('sale con 0 sin regresiones y con 1 con regresiones', () => {
    assert.equal(run('--current', ok, '--baseline', base).status, 0);
    assert.equal(run('--current', slow, '--baseline', base).status, 1);
  });

  it('sale con 0 y avisa si no existe la línea base', () => {
    const res = run('--current', ok, '--baseline', join(dir, 'no-existe.json'));
    assert.equal(res.status, 0);
    assert.match(res.stdout, /no existe/);
  });

  it('--update copia la ejecución como nueva línea base', () => {
    const target = join(dir, 'nueva', 'load.json');
    assert.equal(run('--current', slow, '--baseline', target, '--update').status, 0);
    assert.equal(readFileSync(target, 'utf8'), readFileSync(slow, 'utf8'));
  });

  it('sale con 2 si faltan argumentos', () => {
    assert.equal(run().status, 2);
  });
});
