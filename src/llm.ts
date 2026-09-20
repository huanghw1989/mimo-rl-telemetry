/**
 * Minimal OpenAI-compatible chat client shared by every LLM-backed helper
 * (notice translation, content translation, documentation translation).
 *
 * Configuration comes from the environment, falling back to `.env` at the
 * repository root:
 *   OPENAI_BASE_URL   required (e.g. https://api.openai.com/v1)
 *   OPENAI_API_KEY    required
 *   TEXT_MODEL        optional; defaults to DEFAULT_TEXT_MODEL
 *
 * No SDK is used on purpose: the only endpoint we need is /chat/completions,
 * and keeping the surface tiny makes the pipeline easy to audit and to point
 * at any compatible gateway.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TEXT_MODEL, ROOT } from "./paths";

/**
 * Fallback loader for the repository `.env`. Only fills variables the process
 * does not already have (standard dotenv semantics) — some launchers inject a
 * partial environment, so we must not return early just because one variable
 * happens to be present.
 */
export function ensureEnv(): void {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

/** Resolve the model id: explicit flag > TEXT_MODEL > built-in default. */
export function pickModel(explicit?: string | null): string {
  ensureEnv();
  return explicit || process.env.TEXT_MODEL || DEFAULT_TEXT_MODEL;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

function contentOf(json: any): string {
  const c = json?.choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p: any) => (typeof p === "string" ? p : p?.text ?? "")).join("");
  throw new Error(`response has no text content: ${JSON.stringify(json).slice(0, 400)}`);
}

/** One non-streaming chat completion. Retries once on a transient failure. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  ensureEnv();
  const base = (process.env.OPENAI_BASE_URL || "").replace(/\/+$/, "");
  const key = process.env.OPENAI_API_KEY;
  if (!base || !key) {
    throw new Error("missing OPENAI_BASE_URL / OPENAI_API_KEY (put them in .env at the repository root)");
  }
  const model = opts.model || pickModel();
  const body: Record<string, unknown> = { model, messages };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;

  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
      return contentOf(await res.json());
    } catch (e) {
      last = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Extract the outermost JSON object from a reply that may be fenced or padded. */
export function extractJson<T = Record<string, unknown>>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`no JSON object in reply: ${text.slice(0, 200)}`);
  return JSON.parse(body.slice(start, end + 1)) as T;
}

/** Ask the model for a JSON object and parse it. */
export async function chatJson<T = Record<string, unknown>>(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<T> {
  return extractJson<T>(await chat(messages, opts));
}

/** Fixed-size worker pool: at most `size` tasks in flight. */
export async function mapPool<T, R>(
  items: T[],
  size: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Split a list into fixed-size chunks. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
