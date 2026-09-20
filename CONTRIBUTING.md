# Contributing to mimo-rl-telemetry

Thanks for taking a look. This is a small, evidence-first project: every claim in the
dashboard and in the analysis is supposed to be traceable to a number in `data/store/` or to
a verbatim quote in `content/sources.json`. The rules below exist to keep it that way.

Two conventions matter more than anything else:

- **Numbers are recomputed, never asserted.** If you add a finding with a number in it, a
  script under `src/` must be able to reproduce it from `data/store/`.
- **Chinese is canonical.** The English content and documentation are generated from the
  Chinese files. Never hand-edit a generated English file.

## Prerequisites

- [Bun](https://bun.sh) **>= 1.1** (declared in `package.json` under `engines`).
- `git`.
- Network access is needed only for `bun run sync`, `bun run verify-sources`,
  `bun run translate`, `bun run translate:content`, and `bun run translate:docs`.
- No model or API key is needed to run the dashboard, the reports, or the checks. If you
  work on translation, copy `.env.example` to `.env` and fill in `OPENAI_API_KEY` /
  `OPENAI_BASE_URL`; `TEXT_MODEL` defaults to `gpt-5.6-luna`. Never commit a real `.env`.

## Run the dashboard

```bash
bun install
bun run reindex      # one-off: build data/telemetry.sqlite from the shipped data/store/ snapshot
bun run server       # -> http://127.0.0.1:8787/
```

`data/telemetry.sqlite` is a derived index and is gitignored; `bun run reindex` rebuilds it
from `data/store/` without touching the network, so a fresh clone works offline. The server
proxies five small live endpoints when online and serves the large series from the local
warehouse; in replay mode (`?asof=<epoch>`) everything comes from the warehouse.

Useful extra flags:

```bash
bun run server -- --port 9000    # different port
bun run server -- --offline      # never proxy upstream, warehouse only
```

## Build the offline export

```bash
bun run export
```

This writes `site/data/bundle.js` (the warehouse packed as `window.__TELEMETRY_BUNDLE__`) and a
self-contained `site/offline.html`. Open that file directly in a browser: replay,
explainers, insights, custom boards, chart linkage, and correlation all work with no server.
The export is a snapshot; re-run it after the data changes. `site/data/bundle.js` is
gitignored — do not commit it.

## Add or edit a metric explainer

Explainers live in `content/_draft/*.json`, one array per group, and are merged into
`content/metrics.json`. Read `content/_brief.md` first: it defines the voice (plain,
engineering-minded, no marketing language), the hard rules (do not invent a number or a
term), and the output format.

Each entry needs the same keys:

```json
{
  "id": "the exact metric tag as it appears in series.json",
  "name": "short human name",
  "group": "group name",
  "unit": "unit / dimension",
  "what": "what it measures",
  "how": "how it is computed or where it comes from",
  "why": "why to watch it during training",
  "read": ["reading rules"],
  "observed": "what this run actually showed, with real numbers",
  "traps": ["common misreadings"],
  "related": ["related metric tags"]
}
```

Then:

```bash
bun run content                  # validate, deduplicate, sort, merge into content/metrics.json
bun run content -- --check       # validate only, write nothing (use in CI)
bun run translate:content        # regenerate content/metrics.en.json (needs .env)
```

`bun run content` fails with exit code 1 if a required field is missing, if
`insights.json` cannot be parsed, or if an explainer references a source `ref` that is not
registered in `content/sources.json`. Merge is the gate — fix the error rather than
loosening the check.

If your explainer needs a new citation, register the source first (see
[Source-registry rules](#source-registry-rules)).

## Add a data insight

Insights live in `content/insights.json`. An entry has `id`, `kind`, `title`, `summary`,
`body[]`, `facts[]`, `verify`, `metrics[]`, and `sources[]` (source refs, not URLs). The
four kinds used by the candidate pipeline are `structural`, `counterintuitive`, `method`,
and `numeric`; hand-written entries in the corpus also use `watch` and `note`.

There are two ways in:

1. **Direct edit.** Append the entry to `content/insights.json`. Keep one claim per entry,
   put the recomputation recipe in `verify`, and give it at least one source ref.
2. **Candidate pipeline.** Write a candidate file at
   `analysis/zh-CN/numbers/A3-candidates-<topic>.json`, with each item shaped as:

   ```json
   {
     "id": "insight-id",
     "kind": "structural | counterintuitive | method | numeric",
     "title": "one-line claim",
     "summary": "the evidence",
     "body": ["paragraphs"],
     "facts": ["key numbers"],
     "source": { "id": "...", "title": "...", "venue": "...", "quote": "...", "topic": "..." }
   }
   ```

   Then run:

   ```bash
   bun run insights             # merge; idempotent, existing ids are skipped
   bun run insights -- --check  # report what would change
   ```

Candidates are proposed, not accepted: wording, count, and de-duplication against existing
insights stay a human decision. Whatever the merge takes, note which entries were accepted
in the analysis notes or the changelog. Finish with `bun run translate:content`.

## Source-registry rules

- **Every URL lives in exactly one place: `content/sources.json`.** Draft explainers and
  insights reference sources by `ref`, with a `stance` and a `note`; `bun run content`
  expands those refs into full entries in `content/metrics.json`. Do not paste URLs into
  drafts or insights.
- **Quotes must be verbatim.** Copy the original sentence; do not paraphrase, translate, or
  trim it into a different meaning. Keep the source's own language.
- Record the source `kind` (`paper`, `report`, `blog`, `doc`, or `self`), plus title,
  authors, venue, year, and topic. `self` means our own recomputation against
  `data/store/`; use it, with the exact numbers, when no external material supports a
  reading.
- **If nothing public supports a reading, say so.** Add the reading to the `gaps` array
  instead of attaching a loosely related paper. Search gaps are a first-class result.
- Research material is staged in `content/_research/*.json` and applied in this order:

  ```bash
  bun run apply-sources    # attach entries from _research/ to drafts and insights
  bun run registry         # merge everything into content/sources.json
  bun run verify-sources   # network: check arXiv titles and web quotes
  ```

  `verify-sources` compares arXiv ids against the official API's real title (a wrong id
  still opens a page, it just opens a different paper) and checks that web quotes appear
  verbatim. Run it with `-- --strict` if you want missing titles to fail the run.

## Add a new upstream API field

The pipeline is deliberately explicit about each stage; a new field has to be threaded
through all of them:

1. `src/paths.ts` — add the endpoint/asset to the constants if it is new.
2. `src/api.ts` — fetch it (with retries and the encoded-URL budget).
3. `src/sync.ts` — persist it during ingest, with an additive merge.
4. `src/store.ts` — add the read/write helpers and merge rule. Values are append-only:
   `null` means "not reported this step"; never overwrite a non-null historical value.
5. `src/db.ts` — add the column/table and index it in `indexRun()` (bump `SCHEMA_VERSION`
   in `src/paths.ts` for a breaking change).
6. `src/server.ts` and `src/export.ts` — expose it to the live dashboard and include it in
   the offline bundle.
7. `docs/zh-CN/01-网站数据文档.md` — document the field, its unit, and how it was verified.
   Add anything implementation-specific to `docs/zh-CN/02-本地遥测与同步机制.md`.
8. If the field is a metric, add or update an explainer in `content/_draft/`.

Then run `bun run analyze`, `bun run check`, and `bun run reindex`.

## Bilingual rule

The project ships in English and Simplified Chinese. The Chinese files are the source of
truth; the English files are generated:

| Canonical | Generated | Command |
| --- | --- | --- |
| `content/metrics.json`, `insights.json`, `sources.json` | the matching `*.en.json` | `bun run translate:content` |
| `docs/zh-CN/*.md` | `docs/en/*.md` | `bun run translate:docs` |
| `analysis/zh-CN/**/*.md` | `analysis/en/**/*.md` | `bun run translate:docs` |

- **Never hand-edit a generated file** (`*.en.json`, `docs/en/`, `analysis/en/`). The next
  translation run overwrites it. Fix the Chinese original and regenerate.
- Terminology is pinned by the glossary in `src/i18n_core.ts`. If you introduce a term that
  must render consistently, add it there.
- `content/notices.zh.json` is the one file that runs the other direction: it holds Chinese
  translations of the English upstream notices, keyed by notice id. `bun run sync`
  translates new notices automatically, and a hand-edited translation is kept unless the
  English original changes.

## Checks to run before you push

```bash
bun run check                    # identity self-check; exit code 0 means every identity holds
bun run check:i18n               # i18n gate: no user-visible Chinese string in the telemetry layer bypasses T()
bun run content -- --check       # explainer validation without writing
bun run analyze                  # warehouse health report
bun run report:length            # and any other report:* affected by your change
bun run verify-sources           # network; run when you touched sources.json
```

`bun run check` verifies the known identities (cost = rate × elapsed, per-step token
counts, monotone step times, series vs. event-stream agreement, sampler-table sums) and
exits non-zero on a real failure. The `report:*` scripts are the recomputation surface for
the analysis notes; they read `data/store/` directly and none of them hard-code a
conclusion number. If you change one and a number moves, update the note that quotes it —
`analysis/zh-CN/notes/` is canonical, and the English note follows via `translate:docs`.

## Commit and PR conventions

- Keep commits small and scoped to one area. A short imperative subject line with an area
  prefix works well: `content: add sampler carryover explainers`,
  `report: fix bench MDE denominator`, `docs: clarify staleness buckets`,
  `site: keep chart height when the explainer pane opens`.
- Run the checks above before opening a PR.
- Never commit `.env`, `data/telemetry.sqlite*`, or `site/data/bundle.js` — they are derived or
  secret, and `.gitignore` already excludes them.
- In the PR description, state what changed, how you verified it, and which source refs you
  added. If a number in a note changed, say why.
- Do not reformat generated files or unrelated content; it buries the real diff.

## Upstream frontend changes

`bun run sync` fetches the upstream static assets, keeps a pristine copy in
`data/upstream/`, and compares hashes. When upstream changes a file it prints a warning and
**does not** overwrite `site/`. When that happens:

1. Diff `data/upstream/` against `site/` to see what upstream changed.
2. Re-apply the local modifications in `site/js/app.js` and `site/index.html`, keeping every
   edit minimal and marked with a `[telemetry]` comment. The telemetry layer itself lives in
   `site/js/telemetry.js`, `site/js/correlate.js`, and `site/telemetry.css`, so most changes need
   no edit to the upstream files at all.
3. Re-run the dashboard and check replay, linkage, notices, boards, and correlation, since
   `telemetry.js` depends on a few upstream internals.
4. Note the upstream version change in `CHANGELOG.md`.
