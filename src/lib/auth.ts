/**
 * Autenticación contra POST /auth.
 *
 * Cada VU tiene su propio runtime de JavaScript, así que la variable del módulo funciona como
 * caché por usuario virtual: cada VU se autentica una vez (como una sesión real) y reutiliza
 * el token. Si la API lo rechaza (403), `invalidateToken` obliga a pedir uno nuevo.
 */
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { config } from './config.ts';
import { Endpoint, json, request } from './http.ts';

interface TokenResponse {
  token?: string;
  reason?: string;
}

let cachedToken: string | undefined;

export function authenticate(): string {
  const res = request('POST', '/auth', Endpoint.auth, {
    username: config.username,
    password: config.password,
  });
  const body = json<TokenResponse>(res);

  // Con credenciales inválidas la API responde 200 con {"reason":"Bad credentials"}:
  // el código de estado no basta, hay que validar el cuerpo.
  const ok = check(res, {
    'auth: status 200': (r) => r.status === 200,
    'auth: devuelve token': () => typeof body?.token === 'string' && body.token.length > 0,
  });
  if (!ok || !body?.token) {
    fail(`No se pudo autenticar (status ${res.status}, reason: ${body?.reason ?? 'n/a'})`);
  }
  return body.token;
}

/**
 * Para setup(): comprueba las credenciales una sola vez y aborta con un mensaje claro, en vez de
 * que cada iteración de cada VU falle con el mismo error.
 */
export function assertCredentialsAreValid(): void {
  const res = request('POST', '/auth', Endpoint.auth, {
    username: config.username,
    password: config.password,
  });
  if (typeof json<TokenResponse>(res)?.token !== 'string') {
    exec.test.abort(
      `Credenciales rechazadas por ${config.baseUrl}/auth para el usuario "${config.username}". ` +
        'Revisa RESTFUL_BOOKER_USUARIO y RESTFUL_BOOKER_CLAVE.',
    );
  }
}

export function getToken(): string {
  cachedToken ??= authenticate();
  return cachedToken;
}

export function invalidateToken(): void {
  cachedToken = undefined;
}
