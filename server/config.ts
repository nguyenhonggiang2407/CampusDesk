export function runtimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  const origin = env.APP_ORIGIN ?? 'http://127.0.0.1:5173';
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin)
    throw new Error(
      'APP_ORIGIN must be an exact HTTP(S) origin without credentials, a path or a trailing slash.',
    );
  if (production && parsed.protocol !== 'https:')
    throw new Error('Production APP_ORIGIN must use HTTPS.');
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be between 1 and 65535.');
  const databasePath = env.DATABASE_PATH ?? './data/campusdesk.sqlite';
  if (!databasePath.trim()) throw new Error('DATABASE_PATH cannot be empty.');
  return {
    port,
    host: env.HOST ?? '127.0.0.1',
    origin,
    databasePath,
    seedDemo: env.DEMO_SEED === '1' || (env.DEMO_SEED === undefined && !production),
    secureCookies: production || env.COOKIE_SECURE === '1',
  };
}
