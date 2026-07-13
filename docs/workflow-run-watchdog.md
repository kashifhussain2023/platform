# Workflow run watchdog — orphaned/stuck run recovery

## The problem

A candidate CV email correctly triggered RecruitAI, and the run got as far as the `a1` (AI scoring)
step — then sat in `RUNNING` forever. Root cause: the API process was killed (repeatedly, during
unrelated `prisma generate` troubleshooting) while that job was actively executing. BullMQ's own
stalled-job detection (which requeues/fails jobs whose lock expired without renewal) needs an
uninterrupted `stalledInterval` window (default 30s) to fire — rapid repeated process kills gave it
no such window, so the job was lost from Redis entirely with **nothing** left to ever mark the
`WorkflowRun`/`WorkflowStepRun` DB rows as failed. The run looked like it was still processing,
indefinitely, with no error anywhere.

This is rare in normal operation (it needs a hard process kill mid-execution, not a graceful
shutdown), but when it happens the symptom — a run silently stuck in RUNNING with no error — gives
no signal to debug from. Worth a permanent fix rather than a one-off manual DB cleanup.

## The fix: a watchdog sweep, not automatic job retries

**Why not just add BullMQ `attempts`/retry to the run job?** A workflow run has REAL side effects —
sent emails, Slack messages, Calendar events, Drive files. If a job is retried after partially
executing (e.g. it already emailed the candidate before crashing on a later step), the engine's
`execute()` starts a fresh run from the TRIGGER — a naive retry would **re-send everything already
sent**, which is worse than the original problem. So job-level retries were deliberately NOT added.

**What was added instead** (`workflows.constants.ts`, `engine/workflow-engine.service.ts`,
`engine/workflow.processor.ts`):
- `WorkflowEngine.sweepStuckRuns()` — finds `WorkflowRun` rows in `PENDING`/`RUNNING` older than
  `WORKFLOW_RUN_STUCK_TIMEOUT_MS` (10 minutes — generous; a real run's AI_STEP calls take seconds,
  a full multi-node run well under a minute, so there's no realistic false-positive). Marks the run
  AND any of its still-`RUNNING`/`PENDING` `WorkflowStepRun` rows `FAILED` with a clear, greppable
  error message. `WAITING` runs (paused at a real APPROVAL) are explicitly untouched — that's an
  intentional pause, not a stall.
- `WorkflowProcessor` registers a repeatable `watchdog` job every 5 minutes via
  `queue.upsertJobScheduler` — the exact same pattern already used by `ConnectorHealthProcessor` for
  its health-check sweep, reusing the SAME `workflow-run` BullMQ queue (a 4th job-data shape,
  `{ watchdog: true }`) rather than standing up a new queue/module.

**Net effect:** a stuck run now self-heals into a clearly-FAILED, greppable state within at most ~15
minutes (10 min timeout + up to 5 min until the next sweep tick) instead of sitting silently in
RUNNING forever. A human (or a future automated retry-UI) can then safely decide whether to re-fire
it, knowing the run legitimately failed rather than "might still be working."

## Verified live

Inserted a synthetic `WorkflowRun`/`WorkflowStepRun` pair directly in Postgres with `createdAt` 15
minutes in the past and status `RUNNING`, manually enqueued a `{ watchdog: true }` job against the
live `workflow-run` queue (bypassing the 5-minute wait), and confirmed within seconds both rows
flipped to `FAILED` with the expected error message. Also confirmed the repeatable scheduler key
(`bull:workflow-run:repeat:workflow-run-watchdog`) is registered in Redis on boot.

## If this happens again

Check `WorkflowRun.error` for the watchdog's message — it explicitly says "swept by the workflow-run
watchdog," distinguishing it from a genuine node-level failure (bad tool call, LLM error, etc.), so
you immediately know it was an infrastructure hiccup (most likely a process restart mid-execution),
not a workflow design bug. Re-fire the same trigger data (`POST /workflows/:id/run` with the original
payload, or re-send the source email) to get a clean result.
