import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express } from "express";

import type { CareerAnalyzer } from "./ai/analyzer.js";
import { createAnalyzerFromEnv } from "./ai/provider.js";
import { buildCareerRadarStatus } from "./demo.js";
import { CareerStore } from "./domain/store.js";
import { JobDiscovery } from "./domain/jobs/search.js";
import { GreenhouseJobSearchProvider } from "./infra/search/greenhouse.js";
import {
  createMcpServer,
  type McpDependencies,
} from "./mcp/createServer.js";

const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|\[::ffff:127(?:\.\d{1,3}){3}\])(?::\d{1,5})?$/i;

export function isLoopbackHost(host: string | undefined): boolean {
  return host !== undefined && LOOPBACK_HOST.test(host);
}

export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try { return isLoopbackHost(new URL(origin).host); } catch { return false; }
}

export function createHttpApp(options: Partial<McpDependencies> = {}): Express {
  const app = express();
  // One store and one lazily created analyzer per HTTP app, shared by every per-request MCP server.
  let analyzer: CareerAnalyzer | undefined;
  const createAnalyzer = options.createAnalyzer ?? (() => createAnalyzerFromEnv());
  const sharedDependencies: McpDependencies = {
    store: options.store ?? new CareerStore(),
    createAnalyzer: () => (analyzer ??= createAnalyzer()),
    fetchJob: options.fetchJob,
    discovery: options.discovery ?? new JobDiscovery(new GreenhouseJobSearchProvider()),
  };

  // This server is private and bound to loopback. Browser pages must not be able to reach it, so
  // both the Host header and (when a browser sends one) the Origin header must name a loopback
  // host. Comparing Origin to Host is not enough: a DNS-rebinding page sends both as its own
  // domain and they match. MCP clients and secure tunnels are server-to-server and omit Origin.
  app.use((request, response, next) => {
    if (!isLoopbackHost(request.get("host")) || !isLoopbackOrigin(request.get("origin"))) {
      response.status(403).json({ error: "Only loopback hosts may access this private server." });
      return;
    }
    next();
  });
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
      // Zod messages can echo input values; every other error in this codebase carries a static message.
      console.error("MCP request failed", describeError(error));
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

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  return error.name === "ZodError" ? error.name : `${error.name}: ${error.message}`;
}
