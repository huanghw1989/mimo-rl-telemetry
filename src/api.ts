/**
 * 原站接口客户端。
 *
 * 站点一共 7 个公开 GET 接口，全部无需鉴权：
 *   /runs        运行列表、首页固定的指标（pins）、数值格式规则、官方指标说明
 *   /status      单次运行的当前状态：成本、步数事件、累计量
 *   /live        动态采样器最新一条采样日志（含最近 60 条滚动明细）
 *   /notices     官方公告
 *   /benchmarks  离线基准评测成绩
 *   /tags        该 run 的全部指标名 + 数据版本号
 *   /series      指定指标的逐步历史（tags 必须分批，URL 有长度上限）
 *
 * 注意：/series 不支持任何区间参数（from/since/start/offset 都会被忽略），
 * 每次都会返回全量数组。所以"增量"只能做在存储层和"要不要发请求"这一层，
 * 见 sync.ts 里的版本比对。
 */
import { API_BASE, MAX_ENCODED_CHARS, SITE_BASE } from "./paths";
import { withRetry } from "./util";

const HEADERS = { "User-Agent": "mimo-rl-telemetry/1.0 (+local archival)" };

export async function apiGet<T = any>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  return withRetry(`GET ${path}`, async () => {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  });
}

/** 站点指标名很长（有的单个超过 200 字符），必须按 URL 编码后的长度分批。 */
export function chunkTags(tags: string[]): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let curLen = 0;
  for (const tag of tags) {
    const seg = encodeURIComponent(tag).length + 3; // +3 是分隔逗号编码后的长度
    if (cur.length && curLen + seg > MAX_ENCODED_CHARS) {
      chunks.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(tag);
    curLen += seg;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export interface SeriesPayload {
  run: string;
  version: string;
  steps: number[];
  walls: number[];
  run_start: number;
  series: Record<string, (number | null)[]>;
}

/** 分批拉全量序列再合并。第一批的 steps/walls/run_start 就是全局的。 */
export async function fetchSeries(
  run: string,
  version: string,
  tags: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<SeriesPayload & { chunks: number }> {
  const chunks = chunkTags(tags);
  const merged: Record<string, (number | null)[]> = {};
  let steps: number[] = [];
  let walls: number[] = [];
  let runStart = 0;
  for (let i = 0; i < chunks.length; i++) {
    const data = await apiGet<SeriesPayload>("/series", {
      run,
      v: version,
      tags: chunks[i].join(","),
    });
    if (!steps.length) {
      steps = data.steps ?? [];
      walls = data.walls ?? [];
      runStart = data.run_start ?? 0;
    }
    Object.assign(merged, data.series ?? {});
    onProgress?.(i + 1, chunks.length);
  }
  return { run, version, steps, walls, run_start: runStart, series: merged, chunks: chunks.length };
}

/** 抓一个静态资源，返回原始字节。用于比对原站前端有没有改版。 */
export async function fetchAsset(path: string): Promise<Uint8Array> {
  return withRetry(`GET ${path}`, async () => {
    const res = await fetch(SITE_BASE + path, {
      headers: { "User-Agent": "Mozilla/5.0 (mimo-telemetry)" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  });
}
