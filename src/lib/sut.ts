/**
 * Utilidades sobre el sistema bajo prueba (SUT) que se usan desde setup() y entre pasos.
 */
import { sleep } from 'k6';
import exec from 'k6/execution';
import { config } from './config.ts';
import { Endpoint, request } from './http.ts';

/**
 * Verifica en setup() que la API responde antes de generar carga. Si no, aborta la prueba con
 * un mensaje claro en vez de producir miles de errores de conexión que parecen un problema
 * de rendimiento.
 */
export function assertSutIsUp(): void {
  const res = request('GET', '/ping', Endpoint.ping, undefined, { expectedStatuses: [201] });
  if (res.status !== 201) {
    exec.test.abort(
      `Restful Booker no está disponible en ${config.baseUrl} (GET /ping devolvió ${res.status}). ` +
        '¿Levantaste el SUT con "docker compose up -d --wait restful-booker"?',
    );
  }
}

/**
 * Pausa entre pasos de un flujo ("think time"). Se aleatoriza ±50 % para que los VUs no
 * golpeen el servidor de forma sincronizada.
 */
export function think(): void {
  if (config.thinkTime <= 0) return;
  sleep(config.thinkTime * (0.5 + Math.random()));
}
