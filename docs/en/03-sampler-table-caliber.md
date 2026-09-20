# Dynamic sampler table field semantics verification (2026-09-20)

## One-sentence conclusion

For the per-data-source table in the “dynamic sampler” panel of `mimo.xiaomi.com/rl`, all five column names come from the site's own frontend code, but **the site has not written a textual explanation for any of the columns**; I recomputed all the summation relations in it using 29 sampler archives, and **except for “the counting units of judged and in flight,” the four columns (source / accepted·target / remaining / judged / in flight) can all be pinned down**; only the last layer of semantics (whether the count is of problems or sequences, and whether it includes cross-step partial rollout) has no public basis, so **this layer was not written into the telemetry page** and is left only in this record awaiting manual feedback.

---

## 1. Why this was done

Task requirement: add per-column explanations to the sampler panel's table, and “do not write data you cannot understand into the page.”
The problem is that this table's definitions have always been marked “unconfirmed” — the repository document `docs/en/01-dashboard-data.md` originally said:

> Of the four numbers in `ds`, only the first was confirmed to be “the number of sequences accepted for that dataset.” The remaining three had no public explanation.

This time, three specific questions need to be answered:

1. Which columns does the panel render the `ds` four-tuple `[a, b, c, d]` as? (Do the column names count as “official definitions”?)
2. Can the number in each column be recomputed from relationships internal to the data?
3. Which claims are backed by public materials (papers/technical reports/blogs/GitHub), and which are not?

---

## 2. Conclusion at a glance

| Column | Label on the page | What can be confirmed | What cannot be confirmed | What the page says |
| --- | --- | --- | --- | --- |
| Column 1 | `source` | Data source key names have the form `类目/dataset-短码`; categories are taken from the site's `categories` (code/general/visual/chat/cyber); the two runs have different row sets (pro has no cyber) | The dataset content corresponding to the short code | Explain the key name structure directly, without drilling down into content |
| Column 2 | `accepted / target` | `Σaccepted == 面板 accept`, `Σtarget == 面板 target == 1568`, hold in 29/29 archives; `target` is the sampling quota for each data source (public material: MiMo-V2-Flash technical report §4.6.2) | None (these two items can already be recomputed) | Full explainer |
| Column 3 | `remaining` | **Computed on the page**: `Math.max(0, target − accepted)`, not an API field (original site app.js) | None | Full explainer (and point out that it is not the `remain` at the top of the panel) |
| Column 4 | `judged` | `Σc(上报源) + Σaccepted(未上报源) == 面板 judged`, holds in 29/29 archives; `c ≤ accepted`, holds for 232/232 non-empty values; only the fixed 8 code data sources report | Whether the counting unit is problems or sequences; whether it includes cross-step partial rollout | Write only “the site labels this judged + this identity + the coverage,” and do not write mechanism assertions |
| Column 5 | `in flight` | `Σd == 面板 remain + remain_partial`, holds in 29/29 archives (maximum difference 2); within a step it first rises then falls, and is drained at the end of the step | Per-source breakdown definitions; counting unit | Same as above: write the total identity and the within-step shape |
| Total row | `total` | The `judged` in the total row uses the **panel-wide value**, not the sum of the columns | None | Call out this trap separately |

The columns of the two “batch composition” tables (category/prompts/share/Δ share, harness/rollouts/share) can have their derivation formulas read directly from the frontend code, and have been explained together.

---

## 3. Data verification: method and results

Recomputation script: `src/sampler_report.ts`
Data: `data/store/runs/{pro,flash}/live.jsonl`, one line of `latest` archived per sync; as of 2026-09-20, **29 archives** in total (pro 18 / flash 11).

| Identity | Result |
| --- | --- |
| `Σ accepted == 面板 accept` | 29/29 |
| `Σ target == 面板 target == 1568` | 29/29 |
| `judged_of == accept` | 29/29 |
| `Σ c(上报源) + Σ accepted(未上报源) == 面板 judged` | 29/29 |
| `accept − judged == Σ (accepted − c)` (only subtract reporting sources) | 29/29 |
| `c ≤ accepted` | 232/232 non-empty values |
| `Σ d == 面板 remain + remain_partial` | 29/29, maximum difference 2 (sync rounding) |

Within-step behavior (used to confirm that these columns are “process quantities” rather than “end-of-step values”):

- In pro step 15 (9 archived snapshots), the reporting source's `Σc/Σaccepted` rose from **0.879 to 0.965**, while the panel overall `judged/accept` rose from **0.943 to 0.981** over the same period; the two curves converge in the same direction.
- In pro step 15, `Σd` is **1066 → 1203 → 1474 → 1530 → 1545 → 1537 → 1326 → 861 → 720**, rising first and then falling; in flash step 20, it is **2956 → 2073 → 1162 → 640**, draining all the way down.
- The latest pro archived snapshot (step 28): `accept 1840 / target 1568`, `judged 1766`, of which 8 reporting sources `Σc = 870`, the remaining sources `Σaccepted = 896`, `870 + 896 = 1766`; `Σd = 1594`, at the same moment `remain + remain_partial = 1593`.

Incidentally, two easily confused quantities were confirmed:

- The `passrate` in the panel log and the `dynsam/avg@n` in the series are **not the same number** (example: flash step 27 `0.545` vs `0.644`), because the former is the pass rate of the current sampling batch, and the latter is the average pass rate of the batch of prompts trained into this step.
- The panel's `pr0 / pr1` and the `dynsam/passrate/zero / one` in the series are the same statistic (example: pro step 23 `0.131` vs `0.131014`, `0.242` vs `0.241739`), the difference being that the snapshot is an intra-step process value.

The self-check has written the first three identities into `bun run mimo:check`, and they run with every self-check (currently all 29 items pass).

---

## 4. Public material search results

**Official materials: explain mechanism only, do not define fields.**

- The MiMo-7B technical report (arXiv:2505.07608) §3.3.2 describes the “easy-question re-sampling pool”: full-score questions are filtered out by dynamic sampling, stored in the pool, and re-sampled back proportionally (corresponding to `carryover` on the dashboard); §3.4.1 describes continuous rollout, asynchronous grading, and early termination (after enough for a batch is collected, in-flight tasks are terminated by FIFO), and gives the definition “Sample Waste Ratio = valid samples sampled in excess / batch demand”—this is the mechanistic background for “accepted volume exceeding target”.
- MiMo-V2-Flash technical report (arXiv:2601.02780) §4.6.2 Data Scheduler: each data source has an independent `sample quota` and determines accepted volume based on pass rate and configured proportion; in dynamic sampling, after sequences return, it continues dispatching questions with reference to historical pass rates, and uses partial rollout to split overly long trajectories across multiple steps. **This is the closest official basis for the two columns “accepted / target”.**
- DAPO (arXiv:2503.14476)'s dynamic sampling: after oversampling, questions with pass rates of 0 and 1 are filtered out, ensuring that the batch has valid gradients.
- In the site's own `api/runs`, 22 `descriptions` entries **do not have** a single `accept / target / judged / in flight / remain / prewarm`; the site blog has only one MiMo-V2-Flash release post and does not contain sampler content.

**Third-party materials: only one article discusses it field by field, and the author labels it as an interpretation.**

- QbitAI's 2026-09-17 report described the asynchronous pipeline behind the sampling panel (“some Agents are still executing in the environment, some are waiting for grading, some are computing Reward”), but it does not define the columns.
- `bingqiangzhou.github.io/posts/xiaomi-mimo-rl-live/` is currently the only public material that discusses this table field by field; the author explicitly writes “design details I read out from the dashboard.” It reads `in flight` as “samples are still running in the sandbox,” which does not conflict with our data, but **it is not an official description** and can only serve as corroborating evidence.

**The site announcement provides two pieces of corroborating evidence.**

- “there was a network connectivity issue between the pro training cluster and the **grader deployment**.”
  —— The site itself admits that an independent grading service exists; this is the strongest official corroborating evidence that “judged counts grading progress,”
  but it is still not a definition of this counter.
- “we **filtered out tasks that are relatively easy** for the current pro model.”
  —— The official material directly states that easy questions are filtered out; this is exactly why the accepted volume will exceed the quota and more must continue to be sampled in.
- Additionally, in the site's `descriptions`, `env/active` is defined as “sandbox environments in flight,”
  indicating that “in flight” is the site's own wording habit (in flight), but that is a count of environments, not a column of this table.

**GitHub: there are 5 third-party mirrors; some of them reversed the column names, but none has done a column-by-column interpretation.**

Searching by repository name (2026-09-20), a total of 5 projects are scraping this data, all created on 2026-09-17, 0 star:

| Repository | What it does | Can it serve as evidence |
| --- | --- | --- |
| `AbhyudayPatel/rl-observatory` | Faithful passthrough: reads `live.judged` as a first-class field, and does not call the third position of the four-tuple in flight | **Can serve as independent cross-validation** (its implementation matches the original site's column names) |
| `LianxinRay/mimo-rl-mission-control` | The collection script comment says “per-source `[accepted, target, in_flight, x]`”; the page renders the **third position** (marked `judged` on the original site) as the header `IN FLIGHT` and drops the fourth position | **Counterexample, do not use**; it reverses c and d |
| `Project516/mimo-rl-status` | Status display only | Does not involve column semantics |
| `YYY-676/mimo-rl-archive` | Purely archives API snapshots | Does not involve column semantics |
| `ashafizullah/mimo-baby` | Plain-language restatement | Does not involve column semantics |

That is: among public open-source telemetry, there is both an implementation whose column mapping matches ours and one that reverses it,
but **no project has done a column-by-column interpretation of the `ds` four-tuple**.

**Naming comparison with open-source frameworks.** Searched frameworks such as verl, slime, OpenRLHF, ROLL, AReaL:
**No framework uses `accepted / target / judged / in flight / remaining`, this entire set of column names,**
much less does any framework have a metric called `judged` or `judged_of`.**
The closest is AReaL's per-rollout counter `stats.{enqueued, running, accepted, rejected}`
(there is `on_rollout_accepted/rejected`, indicating that `accepted` is real framework vocabulary, but there is no `judged`),
as well as slime's `remaining_batch_size` (“number of pending tasks”) + `--over-sampling-batch-size` + `pop_first` (FIFO retrieval),
verl's `filter_groups` / `num_prompt_in_batch` vs `train_batch_size`.
`in_flight` / `inflight` appear in several frameworks (TRL, NeMo-RL, rLLM, ROLL, etc.),
but their meanings are all “currently in-flight requests/sessions” or the mixing of old and new weights in partial rollout,
**never the kind of in-flight volume that is split by data source and sums to remain + remain_partial**.
This indicates that the column names on the dashboard are MiMo's own UI vocabulary and were not inherited from any framework, so they cannot be found in framework documentation.
(Note: in the table above, apart from rl-observatory and mission-control, several other frameworks' field names come from second-hand materials,
and were not checked one by one against source files; they serve only as clues and are not written into the page.)

**Easily confused “same-name metrics.”** The site's metric tree does have a group of metrics with `judge`
（`penalty/stage_credit_group/judge_pool_in_flight`、`judge_pending`、`groups_judged`、
`judge_pass1_attempts` etc.), but they belong to another subsystem (grader group / credit assignment), and their magnitude is only tens to one hundred,
They are not the same thing as the `in flight` that totals about 1600 in this table. **Do not use them to validate this column.**

---

## 5. Parts still unconfirmed and left for human feedback

The following **were not written into the page** (the page only wrote the recomputable structure), nor were they put into the explainer body:

1. **The counting unit of `judged` / `in flight`.** It is known that “panel judged = c of reporting sources + accepted of non-reporting sources”,
   but whether `c` and `d` count **tasks (prompt / task group) or rollout sequences** (16 per task),
   and whether partial rollout fragments are counted in, there is no basis for either. Both of these columns in the data can be matched to the panel's own
   totals, but the totals themselves also have no unit explanation. The most natural reading is “tasks”, but this is an inference and was not written into the page.
2. **Why exactly 8 code data sources report `c`.** These 8 sources are completely identical across the two runs
   (bvg7 / v7yx / dnpn / ta4j / sin0 / obg8 / zg6q / x7wh), and **the guess “empty value = accepted volume did not reach quota” is wrong**
   (counterexamples: `[172, 154, null, 86]`, `[57, 55, null, 187]`); `4onq / m1dt / yfch`, which is also code,
   has also always been empty. So empty values are split by “data source/grading method”, not by progress.
   The reasonable guess is related to “code data that requires running test cases for grading goes through an independent grader pipeline”
   (“grader deployment” did indeed appear in the site announcements), but **no public text can confirm it**,
   the page only wrote the fact that “coverage is fixed”.
3. **The per-source breakdown basis for `in flight`.** The total is identically equal to `remain + remain_partial`, but why some sources' `in flight` is even larger than their own `accepted` (e.g., in the latest pro archive `code/dataset-obg8` is 257 vs 155) cannot be determined from the existing data.
4. **The relationship among `remain` / `remain_partial` / `remain_seq`.** The panel log labels them as “remaining / partial / rewarding”, of which `remain_seq` being labeled “rewarding” is the only semantic clue the site itself provides; there is no basis for whether these three buckets are mutually exclusive or whether `in flight` takes only the first two.
5. **`working` / `prewarm_wait` / `partial` (three-element array) have no page label**, and were not explained this time.

**Recommendation for human judgment**: wait for Xiaomi's open-source details as Luo Fuli said, or ask the dashboard author directly; before that, these five items should not appear in the page or README in any definitive tone.

---

## 6. What the page ultimately published and did not publish

**Published (`content/_draft/table-columns.json`, 7 items, group “Sampler Table”)**:

- `table/sampler/source`、`table/sampler/accepted-target`、`table/sampler/remaining`、`table/sampler/judged`、`table/sampler/inflight`
- `table/comp/trained`、`table/comp/metric`

Three constraints were applied to the wording: recomputable identities are written directly and given numbers; column names are always annotated as “from the original site's rendering code”; anything in public materials that goes only as far as the mechanism is uniformly marked as “background/corroborating evidence”, and third-party interpretations are explicitly marked as “external interpretation, not official explanation”. The five unconfirmed items in Section 5 did not enter the body text; only in the “Easy to Misread” section of the `judged` / `in flight` cards was the negative-form hint “the counting unit has no public explanation” written.

**Not published**: all five items in Section 5, as well as any third-party claims such as “accept in excess first, then trim” and “seven-state machine” (they appear only in provenance under a “background” stance and are noted as external interpretation).

---

## 7. How to verify it yourself

```bash
# Row-by-row identities for the sampler table (that is, the table in section 3 of this document)
bun src/sampler_report.ts

# The same identities are run along with the repository self-check
bun run mimo:check

# Artifacts (raw numbers that can be recomputed)
analysis/zh-CN/numbers/A3-sampler-numbers.json
```

On the page, click any column header of the dynamic sampler table, or go to the “Explainer” panel → “Sampler Table” group, and you can see this batch of content.
