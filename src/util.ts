/** 读写小工具：原子写、JSONL 追加、哈希。 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

export function readJson<T = any>(p: string, fallback: T): T {
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

export function writeJson(p: string, value: unknown, pretty = true): void {
  writeText(p, JSON.stringify(value, null, pretty ? 2 : 0) + "\n");
}

/** 先写临时文件再改名，避免同步中途被打断留下半个文件。 */
export function writeText(p: string, text: string): void {
  ensureDir(dirname(p));
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, p);
}

export function writeBytes(p: string, buf: Uint8Array): void {
  ensureDir(dirname(p));
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, buf);
  renameSync(tmp, p);
}

export function appendLine(p: string, obj: unknown): void {
  ensureDir(dirname(p));
  appendFileSync(p, JSON.stringify(obj) + "\n", "utf8");
}

export function readJsonl<T = any>(p: string): T[] {
  if (!existsSync(p)) return [];
  const out: T[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const s = line.trim();
    if (s) out.push(JSON.parse(s) as T);
  }
  return out;
}

export function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** 少量重复调用的推退重试。 */
export async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1) await Bun.sleep(1200 * (i + 1));
    }
  }
  throw new Error(`${label} failed ${attempts} times in a row: ${last instanceof Error ? last.message : String(last)}`);
}

/** 秒级时间戳 → 便于阅读的 UTC 串。 */
export function iso(epochSeconds: number | null | undefined): string {
  if (epochSeconds == null || !Number.isFinite(epochSeconds)) return "—";
  return new Date(epochSeconds * 1000).toISOString().replace(".000Z", "Z");
}

/** 秒级时间戳 → 北京时间串。 */
export function bj(epochSeconds: number | null | undefined): string {
  if (epochSeconds == null || !Number.isFinite(epochSeconds)) return "—";
  const d = new Date((epochSeconds + 8 * 3600) * 1000);
  return d.toISOString().slice(0, 19).replace("T", " ") + " +08";
}

export function nowSeconds(): number {
  return Date.now() / 1000;
}
