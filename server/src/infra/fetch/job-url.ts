import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { load } from "cheerio";
import ipaddr from "ipaddr.js";

export const ALLOWED_JOB_HOSTS = ["boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"];
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;
const FALLBACK = "Paste the job-description text instead.";

export function allowedJobUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error(`Invalid job URL. ${FALLBACK}`); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !ALLOWED_JOB_HOSTS.includes(url.hostname)) {
    throw new Error(`Use an HTTPS URL on ${ALLOWED_JOB_HOSTS.join(", ")}. ${FALLBACK}`);
  }
  url.hash = "";
  return url;
}

export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === "unicast"; } catch { return false; }
}

export function extractJobText(html: string): string {
  const $ = load(html);
  $("script, style, noscript, nav, header, footer, form, [hidden]").remove();
  $("p, div, li, br, h1, h2, h3, section").append("\n");
  const main = $("main").first();
  const article = $("article").first();
  return (main.length ? main : article.length ? article : $("body")).text()
    .replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

type Page = { status: number; location?: string; contentType: string; body: string };
export type JobFetchDependencies = {
  resolve: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  read: (url: URL, address: { address: string; family: number }, signal: AbortSignal) => Promise<Page>;
};

// Connect to the validated IP, retaining the original hostname for TLS and Host.
// No ambient cookies, authorization, proxy credentials, or caller headers are forwarded.
const readPage: JobFetchDependencies["read"] = (url, address, signal) => new Promise((resolve, reject) => {
  const req = request(url, {
    method: "GET", agent: false, signal, family: address.family,
    lookup: (_host, _options, callback) => callback(null, address.address, address.family),
    headers: { Accept: "text/html, text/plain", "Accept-Encoding": "identity", "User-Agent": "CareerRadar/0.2 (private job reader)" },
  }, (response) => {
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      response.destroy();
      resolve({ status, location: response.headers.location, contentType: "", body: "" });
      return;
    }
    const contentType = response.headers["content-type"] ?? "";
    if (status !== 200 || !/^(text\/html|text\/plain)(;|$)/i.test(contentType) || (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")) {
      response.destroy();
      reject(new Error(`Job page is unavailable or not readable HTML/text. ${FALLBACK}`));
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) { req.destroy(new Error(`Job page exceeds 1 MB. ${FALLBACK}`)); return; }
      chunks.push(chunk);
    });
    response.on("error", reject);
    response.on("end", () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }));
  });
  req.on("error", reject);
  req.end();
});

export async function fetchJobUrl(input: string, dependencies: JobFetchDependencies = {
  resolve: (hostname) => lookup(hostname, { all: true }), read: readPage,
}): Promise<{ text: string; sourceUrl: string; warnings: string[] }> {
  let url = allowedJobUrl(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error(`Job fetch timed out. ${FALLBACK}`)), { once: true });
  });
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const addresses = await Promise.race([dependencies.resolve(url.hostname), aborted]);
      if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) throw new Error(`Job host must resolve only to public IP addresses. ${FALLBACK}`);
      const page = await Promise.race([dependencies.read(url, addresses[0]!, controller.signal), aborted]);
      if ([301, 302, 303, 307, 308].includes(page.status) && page.location) {
        url = allowedJobUrl(new URL(page.location, url).href);
        continue;
      }
      if (page.status !== 200 || !/^(text\/html|text\/plain)(;|$)/i.test(page.contentType)) throw new Error(`Job page is unavailable. ${FALLBACK}`);
      if (Buffer.byteLength(page.body) > MAX_BYTES) throw new Error(`Job page exceeds 1 MB. ${FALLBACK}`);
      const text = page.contentType.startsWith("text/plain") ? page.body.trim() : extractJobText(page.body);
      if (text.length < 50 || text.length > 80_000) throw new Error(`Job page has too little or too much readable text. ${FALLBACK}`);
      return { text, sourceUrl: url.href, warnings: ["Fetched public page text without executing JavaScript. Verify the extracted job; navigation or consent text may remain."] };
    }
    throw new Error(`Too many job-page redirects. ${FALLBACK}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes(FALLBACK)) throw error;
    throw new Error(`Could not read the public job page. ${FALLBACK}`, { cause: error });
  } finally { clearTimeout(timeout); }
}
