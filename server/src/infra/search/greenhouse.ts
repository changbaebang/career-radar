import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { load } from "cheerio";
import { z } from "zod";
import { JobSearchInputSchema, type JobSearchInput, type SearchCandidate } from "@career-radar/shared";
import { extractJobText, isPublicAddress } from "../fetch/job-url.js";

export type SearchHit = { candidate: SearchCandidate; description: string };
export type ProviderSearchResult = {
  provider: string; sourceUrl: string; retrievedAt: string;
  matchedCount: number; hits: SearchHit[]; warnings: string[];
};
export interface JobSearchProvider {
  search(input: JobSearchInput): Promise<ProviderSearchResult>;
}

const HOST = "boards-api.greenhouse.io";
const MAX_BYTES = 5_000_000;
const FAILURE = "Greenhouse search could not be read. Check the board token or retry later; pasted JD analysis is still available.";
type Address = { address: string; family: number };
export type GreenhouseNetwork = {
  resolve: (hostname: string) => Promise<Address[]>;
  read: (url: URL, address: Address, signal: AbortSignal) => Promise<string>;
};

// Fixed GET destination; never forwards cookies/keys and never follows redirects. IP pinning
// retains HTTPS certificate validation for HOST, just as in the existing public JD fetcher.
const readJson: GreenhouseNetwork["read"] = (url, address, signal) => new Promise((resolve, reject) => {
  const req = request(url, {
    method: "GET", agent: false, signal, family: address.family,
    lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    headers: { Accept: "application/json", "Accept-Encoding": "identity", "User-Agent": "CareerRadar/0.3 (private job discovery)" },
  }, (response) => {
    if (response.statusCode !== 200 || !/^application\/json(?:;|$)/i.test(response.headers["content-type"] ?? "") ||
      (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")) {
      response.destroy(); reject(new Error(FAILURE)); return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) { req.destroy(new Error(FAILURE)); return; }
      chunks.push(chunk);
    });
    response.on("error", reject);
    response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
  req.on("error", reject);
  req.end();
});

const ProviderJobSchema = z.object({
  id: z.number().int().positive().safe(), internal_job_id: z.number().nullable().optional(),
  title: z.string().trim().min(1).max(500), location: z.object({ name: z.string().max(500) }),
  content: z.string().min(1).max(300_000), updated_at: z.string().optional(),
});

export class GreenhouseJobSearchProvider implements JobSearchProvider {
  constructor(
    private readonly network: GreenhouseNetwork = { resolve: (host) => lookup(host, { all: true }), read: readJson },
    private readonly now: () => Date = () => new Date(),
  ) {}

  async search(raw: JobSearchInput): Promise<ProviderSearchResult> {
    const input = JobSearchInputSchema.parse(raw);
    const url = new URL(`https://${HOST}/v1/boards/${input.boardToken}/jobs?content=true`);
    const signal = AbortSignal.timeout(10_000);
    const aborted = new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error(FAILURE)), { once: true });
    });
    try {
      const addresses = await Promise.race([this.network.resolve(HOST), aborted]);
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error(FAILURE);
      const body = await Promise.race([this.network.read(url, addresses[0]!, signal), aborted]);
      if (Buffer.byteLength(body) > MAX_BYTES) throw new Error(FAILURE);
      const payload = z.object({ jobs: z.array(z.unknown()).max(10_000) }).parse(JSON.parse(body));
      const retrievedAt = this.now().toISOString();
      const hits: SearchHit[] = [];
      const seen = new Set<number>();
      let skipped = 0;
      let unknownDates = 0;
      for (const value of payload.jobs) {
        const parsed = ProviderJobSchema.safeParse(value);
        if (!parsed.success) { skipped++; continue; }
        const job = parsed.data;
        // Prospect/talent-pool posts are not concrete openings.
        if (job.internal_job_id === null || seen.has(job.id)) continue;
        seen.add(job.id);
        if (input.titleKeywords && !input.titleKeywords.toLowerCase().split(/\s+/).every((word) => job.title.toLowerCase().includes(word))) continue;
        if (input.location && !job.location.name.toLowerCase().includes(input.location.toLowerCase())) continue;
        // The API may entity-encode HTML. Decode at most two layers, then remove unsafe markup.
        let html = job.content;
        for (let i = 0; i < 2 && !/<[a-z][\s\S]*>/i.test(html) && /&(?:lt|amp);/.test(html); i++) html = load(html).text();
        const description = extractJobText(html);
        if (description.length < 50 || description.length > 80_000) { skipped++; continue; }
        const date = job.updated_at ? Date.parse(job.updated_at) : NaN;
        const updatedAt = Number.isFinite(date) ? new Date(date).toISOString() : undefined;
        if (!updatedAt) unknownDates++;
        hits.push({ description, candidate: {
          candidateId: `greenhouse_${input.boardToken}_${job.id}`, title: job.title,
          boardToken: input.boardToken, location: job.location.name,
          // Do not expose or follow arbitrary absolute_url values supplied by job metadata.
          sourceUrl: `https://job-boards.greenhouse.io/${input.boardToken}/jobs/${job.id}`,
          retrievedAt, ...(updatedAt ? { updatedAt } : {}),
        } });
      }
      hits.sort((a, b) => (b.candidate.updatedAt ?? "").localeCompare(a.candidate.updatedAt ?? "") || a.candidate.candidateId.localeCompare(b.candidate.candidateId));
      return {
        provider: "Greenhouse Job Board API", sourceUrl: url.href, retrievedAt,
        matchedCount: hits.length, hits: hits.slice(0, input.limit),
        warnings: [
          "One named board only, not the whole job market. Title/location filters and ordering are discovery, not fit assessment.",
          "Retrieved time is not published time. Provider update times do not prove availability; verify the source before applying.",
          ...(skipped ? [`Skipped ${skipped} malformed or unreadable posts.`] : []),
          ...(unknownDates ? [`Provider update time is unknown for ${unknownDates} matching posts.`] : []),
          ...(hits.length > input.limit ? ["Only the requested number of recent matching posts is shown."] : []),
        ],
      };
    } catch {
      // Do not expose provider payloads, parsing diagnostics, or network error details.
      throw new Error(FAILURE);
    }
  }
}
