import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  CareerRadarStatusSchema,
  type CareerRadarStatus,
} from "@career-radar/shared";

declare global {
  interface Window {
    openai?: {
      toolOutput?: unknown;
    };
  }
}

const styles = `
  :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 280px; color: #17211b; background: transparent; }
  .card { position: relative; overflow: hidden; padding: 22px; border: 1px solid rgba(24, 82, 54, .18); border-radius: 20px; background: linear-gradient(145deg, #f7fbf8 0%, #eef7f1 100%); box-shadow: 0 16px 40px rgba(21, 72, 48, .10); }
  .card::after { content: ''; position: absolute; width: 180px; height: 180px; right: -80px; top: -90px; border-radius: 50%; background: rgba(48, 164, 101, .12); }
  .eyebrow { margin: 0 0 8px; color: #317653; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  h1 { position: relative; z-index: 1; margin: 0; font-size: 24px; line-height: 1.2; }
  .status { display: inline-flex; align-items: center; gap: 8px; margin: 16px 0 12px; padding: 7px 11px; border-radius: 999px; background: #dff4e7; color: #175b38; font-size: 13px; font-weight: 700; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #24a35a; box-shadow: 0 0 0 4px rgba(36, 163, 90, .13); }
  .message { margin: 0; max-width: 42ch; color: #405147; font-size: 14px; line-height: 1.55; }
  ul { display: grid; gap: 8px; margin: 18px 0 0; padding: 0; list-style: none; }
  li { display: flex; gap: 9px; align-items: center; color: #31483a; font-size: 13px; }
  li::before { content: '✓'; display: grid; place-items: center; width: 19px; height: 19px; border-radius: 6px; color: white; background: #2f8c58; font-size: 11px; font-weight: 800; }
  .loading { padding: 22px; color: #506258; font-size: 14px; }
  @media (prefers-color-scheme: dark) { body { color: #e6f3ea; } .card { border-color: rgba(137, 217, 170, .2); background: linear-gradient(145deg, #17211b 0%, #1d3024 100%); } .eyebrow { color: #81d6a5; } .status { color: #b9edca; background: rgba(61, 165, 103, .22); } .message, li { color: #c3d6ca; } }
`;

function parseStatus(value: unknown): CareerRadarStatus | null {
  const result = CareerRadarStatusSchema.safeParse(value);
  return result.success ? result.data : null;
}

function App() {
  const [status, setStatus] = useState<CareerRadarStatus | null>(() =>
    parseStatus(window.openai?.toolOutput),
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0") return;
      if (message.method !== "ui/notifications/tool-result") return;

      const nextStatus = parseStatus(message.params?.structuredContent);
      if (nextStatus) setStatus(nextStatus);
    };

    window.addEventListener("message", onMessage, { passive: true });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!status) {
    return <div className="loading">Waiting for Career Radar status…</div>;
  }

  return (
    <article className="card" aria-label="Career Radar status">
      <p className="eyebrow">{status.milestone}</p>
      <h1>{status.name}</h1>
      <div className="status">
        <span className="dot" aria-hidden="true" />
        Scaffold ready
      </div>
      <p className="message">{status.message}</p>
      <ul>
        {status.capabilities.map((capability) => (
          <li key={capability}>{capability}</li>
        ))}
      </ul>
    </article>
  );
}

const styleElement = document.createElement("style");
styleElement.textContent = styles;
document.head.append(styleElement);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Career Radar widget root was not found.");
createRoot(rootElement).render(<App />);
