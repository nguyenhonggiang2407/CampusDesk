import { createApp } from './app.js';
import { runtimeConfig } from './config.js';
import { seedDemoLogin } from './database.js';
const { port, host, demoLogin, ...config } = runtimeConfig();
const { app, db, close } = await createApp({
  ...config,
  serveClient: true,
});
try {
  if (demoLogin) await seedDemoLogin(db, demoLogin);
} catch (error) {
  close();
  throw error;
}
const server = app.listen(port, host, () =>
  console.log(`CampusDesk API listening on http://${host}:${port}`),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () =>
    server.close(() => {
      close();
      process.exit(0);
    }),
  );
