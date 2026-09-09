import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CareerRadarStatusSchema } from "@career-radar/shared";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { buildCareerRadarStatus } from "../demo.js";

export const STATUS_WIDGET_URI = "ui://career-radar/status-v1.html";

function readWidgetBundle(): string {
  const bundlePath = fileURLToPath(
    new URL("../../../web/dist/widget.js", import.meta.url),
  );

  try {
    return readFileSync(bundlePath, "utf8");
  } catch (error) {
    throw new Error(
      `Career Radar widget bundle not found at ${bundlePath}. Run pnpm build first.`,
      { cause: error },
    );
  }
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "career-radar",
    version: "0.0.0",
  });

  registerAppTool(
    server,
    "career_radar_status",
    {
      title: "Show Career Radar status",
      description:
        "Use this when the user wants to verify that the Career Radar MCP server and widget are connected. It returns deterministic Milestone 0 status data and does not access candidate or job information.",
      inputSchema: {},
      outputSchema: CareerRadarStatusSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        securitySchemes: [{ type: "noauth" }],
        ui: { resourceUri: STATUS_WIDGET_URI },
        "openai/outputTemplate": STATUS_WIDGET_URI,
        "openai/toolInvocation/invoking": "Checking Career Radar…",
        "openai/toolInvocation/invoked": "Career Radar is ready",
      },
    },
    async () => {
      const status = buildCareerRadarStatus();

      return {
        structuredContent: status,
        content: [
          {
            type: "text" as const,
            text: "Career Radar Milestone 0 is ready. The status widget is rendering the same structured result.",
          },
        ],
      };
    },
  );

  registerAppResource(
    server,
    "Career Radar status widget",
    STATUS_WIDGET_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Minimal Career Radar Milestone 0 status card.",
    },
    async () => ({
      contents: [
        {
          uri: STATUS_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: `<div id="root"></div><script type="module">${readWidgetBundle()}</script>`,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: [],
              },
            },
            "openai/widgetDescription":
              "A compact card confirming that the Career Radar MCP server and React widget are connected.",
            "openai/widgetPrefersBorder": true,
          },
        },
      ],
    }),
  );

  return server;
}
