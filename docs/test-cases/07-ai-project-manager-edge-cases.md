# AI Project Manager (PMAI) — Edge Cases
**Role:** `PROJECT_MANAGER` · **Suggested skills:** jira, slack, calendar · **Persona:**
coordinates tasks, chases status updates, surfaces risks early, keeps projects on track.

---

### PM-01 — "What's the status of ENG-123?" (chase status updates)
**Steps:** ask PMAI for the status of a specific Jira issue.
**Expected:** should be answerable via a real tool call.
**Status:** ✅ **Fixed this session** — `jira.get_issue` was added. Before this fix, Jira's ONLY
tool was `create_issue` — PMAI's headline job ("chase status updates") had **no way to read any
issue's status at all**, a fully broken promise. Live-verified generically (mock executor).

### PM-02 — "List all open tasks in the ENG project" (coordinate tasks)
**Status:** ✅ **Fixed this session** — `jira.list_issues` was added (optionally filtered by
status), backing "coordinate tasks" for the first time.

### PM-03 — "Move ENG-123 to Done" (actually managing the board)
**Status:** ✅ **Fixed this session** — `jira.transition_issue` was added. Previously PMAI could
CREATE new issues but never move an existing one through its workflow — meaningfully different
from "keeps projects on track," which implies actively managing state, not just filing tickets.

### PM-04 — Scheduling a status-review meeting
**Status:** ✅ **Handled** — `calendar.create_event` already existed and works; no gap.

### PM-05 — "Do we have any scheduling conflicts this week?"
**Why it matters:** `calendar` only has `create_event` — no `list_events`/`check_availability`.
**Status:** ⚠️ **Not fixed this session (lower priority)** — PMAI can propose a NEW event but
can't see what's ALREADY on the calendar. Flagged, not addressed — a smaller gap than the Jira
ones (scheduling is a supporting task, not PMAI's headline promise the way status-tracking is).

### PM-06 — Role-scope guardrail: PMAI asked to do Sales/Legal work
**Status:** ✅ **Handled** — same mechanism verified live this session; `ROLE_SCOPE.PROJECT_MANAGER`
applies. 🧪 not separately re-run with PROJECT_MANAGER specifically as the acting role.

### PM-07 — No real Jira backing yet (mock-only)
**Why it matters:** all 4 jira tools (create/list/get/transition) still fall through to the MOCK
executor — no real Jira API call happens anywhere yet.
**Status:** ⚠️ **Known, platform-wide** — the tool SHAPES are now correct and complete for
PMAI's stated job, but a real `JiraExecutor` (OAuth + actual Jira REST calls) is still needed
before "chases status updates" reflects a REAL project board rather than sandboxed echoes.

### PM-08 — Multi-project ambiguity
**Scenario:** a company has several Jira projects; PMAI is asked "what's overdue?" with no
project specified.
**Status:** 🧪 **Untested** — `list_issues` requires a `project` key as a required parameter; the
LLM would need to either ask a clarifying question or default to the connector's `config.project`
(the installed skill's "Default project key" config field exists for this) — not verified which
actually happens.
