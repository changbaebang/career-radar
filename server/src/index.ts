import { ensureDatabaseDirectory, loadLocalEnv, resolveDatabasePath } from "./config.js";
import { CareerStore } from "./domain/store.js";
import { createHttpApp } from "./httpApp.js";

loadLocalEnv();

const port = Number.parseInt(process.env.PORT ?? "8000", 10);
const databasePath = resolveDatabasePath();
ensureDatabaseDirectory(databasePath);
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
