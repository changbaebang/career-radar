import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CareerStore } from "./domain/store.js";

import { createHttpApp } from "./httpApp.js";

try {
  process.loadEnvFile(
    fileURLToPath(new URL("../../.env.local", import.meta.url)),
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const port = Number.parseInt(process.env.PORT ?? "8000", 10);
const root = fileURLToPath(new URL("../../", import.meta.url));
const databasePath = resolve(root, process.env.CAREER_RADAR_DB_PATH ?? "data/career-radar.db");
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
const store = new CareerStore(databasePath);
const app = createHttpApp({ store });

const httpServer = app.listen(port, "127.0.0.1", () => {
  console.log(
    `Career Radar MCP server listening on http://localhost:${port}/mcp`,
  );
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    httpServer.close(() => { store.close(); process.exitCode = 0; });
  });
}

httpServer.on("error", (error) => {
  console.error("Career Radar HTTP server failed", error);
  process.exitCode = 1;
});
