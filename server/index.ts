import { createApp } from './app.js';
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const { app, close } = await createApp({
  databasePath: process.env.DATABASE_PATH || './data/campusdesk.sqlite',
  seedDemo: process.env.DEMO_SEED === '1' || (process.env.DEMO_SEED === undefined && process.env.NODE_ENV !== 'production'),
  origin: process.env.APP_ORIGIN || 'http://127.0.0.1:5173',
  secureCookies: process.env.COOKIE_SECURE === '1',
  serveClient: true,
});
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`CampusDesk API listening on http://${process.env.HOST || '127.0.0.1'}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => { close(); process.exit(0); }));
