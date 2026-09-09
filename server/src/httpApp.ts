import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express, { type Express } from "express";

import { buildCareerRadarStatus } from "./demo.js";
import { OpenAICareerAnalyzer } from "./ai/analyzer.js";
import { CareerStore } from "./domain/store.js";
import {
  createMcpServer,
  type McpDependencies,
} from "./mcp/createServer.js";

export function createHttpApp(dependencies: McpDependencies = {}): Express {
  const app = express();
  let analyzer = dependencies.analyzer;
  const sharedDependencies: McpDependencies = {
    ...dependencies,
    store: dependencies.store ?? new CareerStore(),
    createAnalyzer: () => (analyzer ??= dependencies.createAnalyzer?.() ?? new OpenAICareerAnalyzer()),
  };

  app.use(
    cors({
      exposedHeaders: ["Mcp-Session-Id"],
      allowedHeaders: [
        "Content-Type",
        "mcp-session-id",
        "mcp-protocol-version",
      ],
    }),
  );
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json(buildCareerRadarStatus());
  });

  app.all("/mcp", async (request, response) => {
    const server = createMcpServer(sharedDependencies);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    response.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error("MCP request failed", error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  return app;
}
