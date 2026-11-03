import { createApp } from './app.js';
import { runtimeConfig } from './config.js';
const config = runtimeConfig();
const { port, host } = config;
const { app, close } = await createApp({
  ...config,
  serveClient: true,
});
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
