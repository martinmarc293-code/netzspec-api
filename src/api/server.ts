// src/api/server.ts — the process entry point: load config, build the app, listen.
//
// Nothing else lives here on purpose. Everything testable is in buildApp(); this file is the
// one place that binds a port, so tests never do.
import { loadEnv } from "../config.js";
import { buildApp } from "./app.js";

const config = loadEnv();
const app = await buildApp({ config, gitSha: process.env.GIT_SHA || "dev", logger: { level: config.LOG_LEVEL } });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, "shutting down");
    app.close().then(() => process.exit(0), (e) => { app.log.error(e); process.exit(1); });
  });
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
