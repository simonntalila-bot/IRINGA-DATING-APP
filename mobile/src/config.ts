/**
 * Runtime configuration.
 *
 * IMPORTANT: this file must never contain secrets. The API host is public by
 * definition; JWTs live in the device keystore (react-native-keychain) and all
 * credentials (database, R2, FCM, payment) stay on the server.
 *
 * Values can be overridden at build time via `globalThis.__IRINGA_CONFIG__`
 * (see app.config.js / EAS), which keeps them out of the JavaScript bundle's
 * source control history.
 */

declare global {
  // eslint-disable-next-line no-var
  var __IRINGA_CONFIG__: { API_BASE_URL?: string; SOCKET_URL?: string } | undefined;
}

const overrides = globalThis.__IRINGA_CONFIG__ ?? {};

/**
 * The API is reached over the public ngrok tunnel so a phone anywhere can use
 * the app. A free ngrok URL changes on every restart - replace these two
 * constants (and APP_PUBLIC_URL / CORS_ORIGINS in backend/.env) whenever the
 * tunnel is restarted, or move both ends to a permanent domain.
 *
 * Android emulator on the same machine should instead use http://10.0.2.2:4000.
 */
const DEFAULT_API = 'https://frill-suitor-gone.ngrok-free.dev/api/v1';
const DEFAULT_SOCKET = 'https://frill-suitor-gone.ngrok-free.dev';

export const API_BASE_URL = overrides.API_BASE_URL ?? DEFAULT_API;
export const SOCKET_URL = overrides.SOCKET_URL ?? DEFAULT_SOCKET;

export const REQUEST_TIMEOUT_MS = 20_000;
