import { fileURLToPath } from "node:url";

import { createHttpApp } from "./httpApp.js";

try {
  process.loadEnvFile(
    fileURLToPath(new URL("../../.env.local", import.meta.url)),
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const port = Number.parseInt(process.env.PORT ?? "8000", 10);
const app = createHttpApp();

const httpServer = app.listen(port, () => {
  console.log(
    `Career Radar MCP server listening on http://localhost:${port}/mcp`,
  );
});

httpServer.on("error", (error) => {
  console.error("Career Radar HTTP server failed", error);
  process.exitCode = 1;
});
