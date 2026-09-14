// M5-D golden text format. Golden cases are raw text (a synthetic resume and a synthetic posting),
// because model mode evaluates extraction as well as assessment. The format is plain enough for a
// real model and regular enough for the deterministic fake analyzer used to verify the runner.
//
//   Headline: <one line>
//   Experience:
//   - <one evidence sentence per line>
//   Skills: <comma separated>            (optional)
//   Constraints: <free text>             (optional)
//
//   Title: <one line>
//   Company: <one line>                  (optional; absent means the posting names no employer)
//   Required:
//   - <one requirement per line>
//   Preferred:
//   - <one requirement per line>         (optional)
//   Responsibilities:
//   - <one per line>                     (optional)

export type ResumeSpec = { headline: string; experience: string[]; skills?: string[]; constraints?: string };
export type PostingSpec = { title: string; company?: string; required: string[]; preferred?: string[]; responsibilities?: string[] };

const bullets = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

export function resumeText(spec: ResumeSpec): string {
  return [
    `Headline: ${spec.headline}`, "", "Experience:", bullets(spec.experience),
    ...(spec.skills?.length ? ["", `Skills: ${spec.skills.join(", ")}`] : []),
    ...(spec.constraints ? ["", `Constraints: ${spec.constraints}`] : []),
  ].join("\n");
}

export function postingText(spec: PostingSpec): string {
  return [
    `Title: ${spec.title}`,
    ...(spec.company ? [`Company: ${spec.company}`] : []),
    "", "Required:", bullets(spec.required),
    ...(spec.preferred?.length ? ["", "Preferred:", bullets(spec.preferred)] : []),
    ...(spec.responsibilities?.length ? ["", "Responsibilities:", bullets(spec.responsibilities)] : []),
  ].join("\n");
}

function section(lines: string[], name: string): string[] {
  const start = lines.findIndex((line) => line.trim() === `${name}:`);
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Z][A-Za-z ]+:/.test(line.trim())) break;
    const match = /^-\s+(.+)$/.exec(line.trim());
    if (match) out.push(match[1]!.trim());
  }
  return out;
}
const field = (lines: string[], name: string) => lines.find((line) => line.startsWith(`${name}:`))?.slice(name.length + 1).trim();

export function parseResume(text: string): ResumeSpec {
  const lines = text.split("\n");
  const skills = field(lines, "Skills");
  const constraints = field(lines, "Constraints");
  return {
    headline: field(lines, "Headline") ?? "Candidate",
    experience: section(lines, "Experience"),
    ...(skills ? { skills: skills.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
    ...(constraints ? { constraints } : {}),
  };
}

export function parsePosting(text: string): PostingSpec {
  const lines = text.split("\n");
  const company = field(lines, "Company");
  const preferred = section(lines, "Preferred");
  const responsibilities = section(lines, "Responsibilities");
  return {
    title: field(lines, "Title") ?? "Role",
    ...(company ? { company } : {}),
    required: section(lines, "Required"),
    ...(preferred.length ? { preferred } : {}),
    ...(responsibilities.length ? { responsibilities } : {}),
  };
}
