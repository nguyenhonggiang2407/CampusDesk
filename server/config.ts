import { z } from 'zod';

const demoLoginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(190)
    .transform((email) => email.toLowerCase()),
  password: z.string().min(10).max(200),
});

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
  let demoLogin: z.infer<typeof demoLoginSchema> | undefined;
  if (env.DEMO_LOGIN_ENABLED === '1') {
    if (!env.DATABASE_PATH || env.DEMO_SEED !== '0')
      throw new Error('Demo login requires an explicit demo DATABASE_PATH and DEMO_SEED=0.');
    const parsedDemo = demoLoginSchema.safeParse({
      email: env.DEMO_LOGIN_EMAIL,
      password: env.DEMO_LOGIN_PASSWORD,
    });
    if (!parsedDemo.success)
      throw new Error('Set valid DEMO_LOGIN_EMAIL and DEMO_LOGIN_PASSWORD values for demo login.');
    demoLogin = parsedDemo.data;
  }
  return {
    port,
    host: env.HOST ?? '127.0.0.1',
    origin,
    databasePath,
    seedDemo: !demoLogin && (env.DEMO_SEED === '1' || (env.DEMO_SEED === undefined && !production)),
    demoLogin,
    secureCookies: production || env.COOKIE_SECURE === '1',
  };
}
