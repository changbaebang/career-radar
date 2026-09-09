import { createHttpApp } from "./httpApp.js";

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
