# Edge-Case Test Scripts — real usage, one script per scenario

Real, runnable scripts for every scenario in `docs/test-cases/*.md` — organized the same way,
one small `.mjs` script per scenario id (e.g. `WF-A2` → `workflow-engine/wf-a2-non-numeric-condition.mjs`).
69 scripts across 7 categories. Run with `node scripts/edge-case-tests/<category>/<script>.mjs`
from the `platform/` directory, with the API running (`pnpm dev`, or point `BASE=` at another one).

## Categories (mirrors docs/test-cases/)

| Folder | Scenarios | Needs YOUR input? |
|---|---|---|
| `workflow-engine/` | 20 (WF-A2..A5, B1..B4, C1..C3, D1..D6, E2..E4) | No — fully automated |
| `recruiter/` | 16 (REC-01..16) | **YES** — guides you to send real emails to `kashifhussain146@gmail.com` |
| `support/` | 9 (SUP-01..09) | No — fully automated (chat only) |
| `hr/` | 5 (HR-01,02,03,04,05) | No — fully automated |
| `finance/` | 5 (FIN-01,02,03,04,06) | No — fully automated |
| `project-manager/` | 6 (PM-01,02,03,04,06,08) | No — fully automated |
| `custom-roles/` | 8 (CUSTOM-01, MKT/PROC/OPS/LEGAL) | No — fully automated |

## How each script works

Every script prints `✔ PASS` / `✘ FAIL` (or `⚠` for informational-only scenarios where there's no
strict pass/fail, e.g. LLM score variance) as it runs, ending in a summary. A non-zero exit code
means at least one assertion failed.

- **Automated categories** (everything except `recruiter/`): register a fresh THROWAWAY test
  company, run the scenario via the real API, assert the documented outcome. Safe to re-run any
  number of times — never touches the real Kashif Recruiting tenant.
- **`recruiter/` scripts** — these test the REAL, live RecruitAI workflow on the REAL connected
  Gmail inbox. They log into the standing Kashif Recruiting tenant, then **pause and tell you
  exactly what email to send** (from/to/subject/body/attachment), wait for you to press Enter,
  poll the connector immediately (no need to wait ~60s), and report what actually happened. Run
  these ONE AT A TIME, follow the printed instructions exactly.

## Running everything in a category

```bash
cd platform
for f in scripts/edge-case-tests/workflow-engine/*.mjs; do node "$f"; done   # fully automated
node scripts/edge-case-tests/recruiter/rec-01-strong-candidate.mjs           # interactive, one at a time
```

## ⚠️ Important discovery from actually running these (read this)

Running the `support/`, `hr/`, `finance/`, `project-manager/`, and `custom-roles/` scripts against
**real GPT** surfaced a genuine, reproducible, SYSTEMIC pattern not previously documented:

**The role-scope chat guardrail (built earlier this session to stop off-role work) sometimes
refuses an explicitly-ASSIGNED tool, especially newly-added ones (`gdrive.read_file`/
`list_files`, `jira.transition_issue`, occasionally `stripe`/`calendar` actions) — even though an
admin deliberately assigned that skill to that employee.** Examples actually observed:
- `SUP-06`: a Support employee with Stripe assigned refused to create a payment link ("that's
  finance work").
- `HR-04`/`HR-05`: an HR employee with calendar/Drive assigned refused to schedule a call or read
  a file ("outside my capabilities").
- `LEGAL-01`: LegalAI — the role whose ENTIRE JOB is reading/extracting from documents — refused
  to read an assigned Drive file, saying Drive access is "outside my capabilities."
- Some DID work (`FIN-01`/`FIN-02` Stripe balance/charges, `PROC-01` email, `OPS-01`/`PM-01`/`PM-02`
  Jira reads) — so it's inconsistent, not a hard block, seemingly correlated with how closely the
  tool's action matches the role's `persona`/scope wording verbatim.

There's also the OPPOSITE failure mode: `PM-06` found PMAI (PROJECT_MANAGER) actually **performing**
an off-role Legal task (extracting a contract clause) instead of declining — unlike every other
role tested, which correctly refused similar off-role requests.

**Net effect:** the guardrail's benefit (blocking off-role chat requests) has a real, inconsistent
cost — it can ALSO block legitimately-assigned tool use, and doesn't generalize evenly across all
roles. This wasn't visible from code reading or from the single SUPPORT→RECRUITER test done
earlier — it only showed up from actually running many real scenarios across many roles, which is
the whole point of this script suite existing. **Not fixed as part of this exercise** — flagging
for a decision on how (or whether) to make assigned-tool-use more reliable without weakening the
off-role refusal that was the original goal.
