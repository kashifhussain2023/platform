# Interview Scheduling — bulk-hiring slot management

Solves the real gap from bulk hiring: workflows process each candidate independently, so without
this, N shortlisted candidates approved around the same time would get conflicting/duplicate
interview slots. This adds a company-wide pool of bookable slots — **custom-controlled** (not random
auto-generated dates), **synced with the real Google Calendar** (never double-books a real meeting),
with a **reschedule** path — that candidate workflows claim from atomically.

## Where to manage it (API today; UI is a follow-up)

No dedicated frontend page yet — everything below is via API (Postman/curl/script), same as the rest
of `scheduling.controller.ts`. A `/scheduling` calendar-grid page (open/booked/blocked slots, a
"Reschedule" button per booking) is the natural next step once this backend is validated — not built
yet, per the agreed "backend first" priority.

| Action | Endpoint | Who |
|---|---|---|
| Generate a recurring weekly pattern | `POST /scheduling/slots/generate` `{startDate,endDate,daysOfWeek,dailyStartHour,dailyEndHour,slotMinutes}` | OWNER/ADMIN |
| Add ONE custom one-off slot | `POST /scheduling/slots` `{start,end}` (ISO datetimes) | OWNER/ADMIN |
| Block a whole date (holiday) | `POST /scheduling/slots/block-date` `{date}` (yyyy-mm-dd) — cancels every still-OPEN slot that day | OWNER/ADMIN |
| Cancel one OPEN slot | `POST /scheduling/slots/:id/cancel` | OWNER/ADMIN |
| **Reschedule** a booked interview | `POST /scheduling/slots/:id/reschedule` `{title?}` | OWNER/ADMIN (HR-triggered, per user's choice — NOT auto-detected from a candidate's reply) |
| List slots | `GET /scheduling/slots?status=OPEN\|BOOKED\|CANCELLED` | any member |
| Summary counts | `GET /scheduling/slots/summary` | any member |

This is the "custom, not random" control the user asked for: the recurring pattern gives you a
baseline, `addSlot`/`blockDate`/`cancelSlot` give you exact per-date override control on top of it.

## How the workflow sees it

A workflow's `TOOL_ACTION` (skillKey `scheduling`, tool `claim_slot`) does ALL of this in one call:
1. Atomically claim the next OPEN slot (conditional UPDATE, race-safe — see below).
2. **Real Google Calendar FreeBusy check** on that slot's time — if the recruiter's actual calendar
   already has something there (e.g. they manually booked something after slots were generated), skip
   it and permanently cancel it (`cancelReason: 'google-calendar-conflict'`), try the next slot.
3. Create the real Calendar event with a real Google Meet link (`addMeetLink` — see
   `real-skill-executor.ts`'s `calendarCreateEvent`), and record the event id + Meet link on the slot
   row (`calendarEventId`, `meetLink`) — this is what makes reschedule possible later.
4. Return `{claimed, slotId, start, end, meetLink, htmlLink}` in one shot — a workflow no longer needs
   a SEPARATE `calendar.create_event` node (removed from "Candidate Details -> Fit Check"; its email
   step reads `{{slotClaim.result.start}}` / `{{slotClaim.result.meetLink}}` directly).

Reschedule (`scheduling.reschedule_slot`, or the REST endpoint above) does the mirror image: delete
the OLD real Calendar event (best-effort), cancel the old slot (`cancelReason: 'rescheduled'`), then
run the exact same claim-and-schedule flow for a NEW slot for the SAME candidate.

## What's built

- **`InterviewSlot` model** — `start`/`end`/`status` (OPEN/BOOKED/CANCELLED)/`bookedFor`/
  `workflowRunId`/`calendarEventId`/`meetLink`/`cancelReason`.
- **`SchedulingService`**: `generate` (recurring), `addSlot`/`blockDate`/`cancelSlot` (custom
  overrides), `claimAndSchedule` (claim + conflict-check + real event + Meet, atomic-ish with
  release-on-failure so a slot is never left BOOKED with no real meeting behind it), `reschedule`
  (delete old event → cancel old slot → claimAndSchedule again).
- **`google-calendar.util.ts`** (`modules/skills/executors/`) — plain-function Calendar API helpers
  (`createGoogleCalendarEvent`, `checkGoogleCalendarFree`, `deleteGoogleCalendarEvent`) shared by both
  `RealSkillExecutor` and `SchedulingService` without the two modules importing each other (would
  close a DI cycle — same rationale as `connectors/credentials.util.ts`).
- **`scheduling` skill** tools: `claim_slot` (candidate flow), `reschedule_slot` (HR flow).
- Verified live: race-safety (10 simultaneous claims → 0 duplicates, from an earlier session), a REAL
  conflicting Calendar event correctly causes that slot to be skipped + cancelled, reschedule deletes
  the old event and books a new one, and all 3 custom day-management endpoints work.

## Two real bugs found while building this (both fixed)

1. **`checkGoogleCalendarFree` initially always returned "free."** Google's FreeBusy API response
   keys `calendars` by the RESOLVED calendar id (the account's real email), not the literal
   `"primary"` string used in the request — indexing the response by the request-time id always
   missed, so `busy` was always read as empty. Fixed by reading whichever single key the response
   actually returned instead of re-using the request's id.
2. **`403 ACCESS_TOKEN_SCOPE_INSUFFICIENT` on the FreeBusy endpoint** — the existing Calendar OAuth
   connection only had the `calendar.events` scope (create/edit events), which does NOT cover
   FreeBusy queries. Added `https://www.googleapis.com/auth/calendar.readonly` alongside it in
   `oauth.providers.ts`. **Any already-connected Calendar skill must be disconnected + reconnected**
   to pick up the new scope (same as the Slack `channels:read` addition earlier this session) — the
   code's own best-effort fallback (`return true` on any error) meant this failure was silent until
   specifically tested with a real conflicting event.

Both were only caught by deliberately creating a REAL conflicting Calendar event and confirming the
claim actually skipped it — a check that returns a plausible-looking result either way (a slot gets
claimed, a Meet link gets created) doesn't by itself prove the conflict-check ran correctly.
