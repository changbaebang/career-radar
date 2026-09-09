import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";

import { createHttpApp } from "../src/httpApp.js";
import { STATUS_WIDGET_URI } from "../src/mcp/createServer.js";

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

async function startTestServer() {
  const httpServer = createHttpApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });

  const address = httpServer.address() as AddressInfo;
  closeCallbacks.push(
    () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  return `http://127.0.0.1:${address.port}`;
}

describe("Career Radar HTTP and MCP server", () => {
  it("serves deterministic readiness data", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: "Career Radar",
      milestone: "Milestone 0",
      state: "ready",
    });
  });

  it("lists and calls the status tool and serves its widget resource", async () => {
    const baseUrl = await startTestServer();
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`),
    );
    const client = new Client({
      name: "career-radar-integration-test",
      version: "0.0.0",
    });

    await client.connect(transport);
    closeCallbacks.push(async () => {
      await client.close();
    });

    const tools = await client.listTools();
    const statusTool = tools.tools.find(
      (tool) => tool.name === "career_radar_status",
    );
    expect(statusTool).toMatchObject({
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        ui: { resourceUri: STATUS_WIDGET_URI },
      },
    });

    const result = await client.callTool({
      name: "career_radar_status",
      arguments: {},
    });
    expect(result.structuredContent).toMatchObject({
      name: "Career Radar",
      state: "ready",
    });

    const resource = await client.readResource({ uri: STATUS_WIDGET_URI });
    expect(resource.contents[0]).toMatchObject({
      uri: STATUS_WIDGET_URI,
      mimeType: "text/html;profile=mcp-app",
    });
    expect(resource.contents[0]?.text).toContain('<div id="root"></div>');
  });
});
