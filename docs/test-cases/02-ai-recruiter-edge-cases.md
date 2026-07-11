# AI Recruiter (RecruitAI) — Edge Cases
**Employee:** RecruitAI (`cmrf5if03000bcs6wjvbvfd22`, role `RECRUITER`) · **Workflow:**
"New Candidate Email -> Screen -> Notify" (`cmrf5ifg9000ncs6w6op01apq`) · **Live inbox:**
`kashifhussain146@gmail.com` (real, CONNECTED). Every scenario below is executable TODAY by
sending a real email.

---

### REC-01 — Strong candidate (score > 79)
**Steps:** send an email to `kashifhussain146@gmail.com`, subject "Application: Senior Backend",
with a PDF attachment describing 7+ years of relevant backend experience.
**Expected:** score >79 → CONDITION true → Approval created with score shown → (if
`autoApprove` off) manager approves in `/approvals` → real shortlist email sent to HR.
**Status:** ✅ **Handled** — live-verified this session (score 95, reached WAITING at Approval).

### REC-02 — Weak candidate (score ≤ 79)
**Steps:** same as above, but CV shows only 2 years of experience.
**Expected:** auto-reject branch, real rejection email sent to the candidate, no approval created.
**Status:** ✅ **Handled** — live-verified (score 10, `t3` gmail send_email `ok:true`, no
approval row created).

### REC-03 — Score exactly at the current policy's stated minimum
**Steps:** CV states EXACTLY the number of years the current Hiring Policy doc requires (policy
currently says 7 years minimum — check `/knowledge` for the live wording).
**Expected:** the model should score this near the threshold, not wildly off in either direction.
**Why it matters:** LLM scoring is not perfectly deterministic — a candidate who exactly meets the
stated minimum is the highest-value case to get right, and the one most likely to flip
inconsistently between runs.
**Status:** 🧪 **Untested** — worth running 3-5 times with the same borderline CV to check
score variance.

### REC-04 — No attachment at all (CV described only in the email body)
**Steps:** send an email with the candidate's experience typed directly in the body, no PDF.
**Expected:** scoring should still work off `{{trigger.body}}` alone.
**Status:** ⚠️ **Partial (changed by the REC-07 fix)** — `{{trigger.body}}` is always populated
regardless of attachment, so scoring itself still works off body alone. BUT the new
`looksLikeApplication` EVENT condition (fixed this session, see REC-07) now gates whether
RecruitAI fires AT ALL: a body-only email is judged by whether the subject/body mentions
application-ish terms (resume/cv/application/apply/candidate/hiring/position/vacancy). A
genuine application phrased without any of those words (rare, but possible) would now be
filtered out before scoring. Worth knowing if you rely on wording-free body-only submissions.

### REC-05 — Multiple candidates in the same ~60s poll window
**Steps:** send 3 different CVs from 3 different addresses within a few seconds of each other,
before the next poll fires.
**Expected:** all 3 get detected and scored independently in one poll cycle.
**Status:** 🧪 **Untested** — `sweep()`/`delta()` process messages in a loop per connector, so this
should work, but hasn't been load-tested with a true multi-message batch.

### REC-06 — Candidate replies to their OWN rejection email
**Steps:** after REC-02 auto-rejects a candidate, that candidate hits "Reply" and sends
"Thank you for letting me know" back to `kashifhussain146@gmail.com`.
**Expected:** ideally, this should NOT be treated as a fresh CV submission.
**Why it matters:** the Gmail history feed reports ANY new message in the mailbox as
`messageAdded` — the mapper previously had no concept of "this is a reply in an existing thread,
not a new application." A one-line "thanks" reply would be fed to the scoring AI_STEP as if it
were a resume, producing a nonsensical (near-zero) score and — worse — **another rejection email
sent to someone who was already rejected.**
**Status:** ✅ **Fixed** — `GmailInboundService` now checks the `In-Reply-To`/`References`
headers; a reply within an existing thread is still recorded (RawEvent/CanonicalEvent, for audit)
but `fireEvent` is never called for it — a hard, driver-level skip that applies regardless of
which workflow/company is listening (not a per-workflow opt-in).

### REC-07 — Random/spam/newsletter email lands in the inbox
**Steps:** any unrelated email arrives (a notification, a newsletter, a personal email) at
`kashifhussain146@gmail.com`.
**Expected:** ideally should NOT trigger the recruiting workflow at all.
**Why it matters:** this isn't hypothetical — it was **observed live this session**: the run log
showed the workflow firing repeatedly for what appear to be routine inbox emails, each one scored
(and likely auto-rejected) as if it were a job application. This wastes LLM calls and could send
an inappropriate "your application was rejected" auto-reply to someone who never applied.
**Status:** ✅ **Fixed** — the driver now computes a `looksLikeApplication` signal (has a
parseable attachment, OR subject/body mentions resume/cv/application/apply/candidate/hiring/
position/vacancy) and exposes it in the flattened trigger payload; RecruitAI's own EVENT trigger
now has a condition (`looksLikeApplication eq true`) opting into this filter. Live-verified via
direct `fireEvent` calls: `looksLikeApplication:false` → 0 runs fired; `:true` → 1 run fired. This
is a per-workflow policy choice (exposed via the existing condition DSL), not hardcoded into the
generic driver — a company that wants every email processed can simply not add the condition.

### REC-08 — Forwarded CV (recruiter forwards a candidate's resume with their own commentary)
**Steps:** someone forwards a candidate's CV to `kashifhussain146@gmail.com` with a note like
"Thoughts on this one?" — the `From` header is the **forwarder**, not the candidate.
**Expected:** the reject/shortlist email should go to the actual candidate, not the forwarder.
**Why it matters:** `{{trigger.from}}` is always the Gmail `From` header — for a forward, that's
the wrong person. A rejection (or shortlist) email would be sent to the internal colleague who
forwarded it, not the candidate, and it would read as if THEY were the rejected applicant.
**Status:** ❌ **Gap** — no distinction between a direct application and a forwarded one.

### REC-09 — CC'd rather than direct recipient
**Steps:** an email is sent with `kashifhussain146@gmail.com` in **Cc**, not **To**.
**Expected:** documented behavior either way.
**Status:** 🧪 **Untested** — inbound detection is "any new message in this mailbox," which
should fire regardless of To/Cc, but this hasn't been explicitly verified.

### REC-10 — Non-PDF resume (DOCX, RTF, Pages export)
**Steps:** send a `.docx` resume instead of PDF.
**Expected:** ideally, its text should still be extracted and scored.
**Status:** ✅ **Fixed (DOCX only)** — `extractText()` now parses `.docx` via a lazily-imported
`mammoth` (same lazy-import pattern as `pdf-parse`), shared by both the Gmail inbound driver and
direct Knowledge uploads. Verified directly against a real `.docx` file (extracted text matched
exactly). RTF and Pages (`.pages`) export are still NOT handled — narrower gap than before, not
fully closed.

### REC-11 — Scanned/photographed resume (image-only PDF, no text layer)
**Steps:** send a PDF that's actually a photo/scan of a printed resume.
**Expected:** ideally OCR'd; realistically, currently empty.
**Status:** ❌ **Gap (known)** — `pdf-parse` extracts embedded text only; no OCR fallback.
Same failure mode and same risk as REC-10.

### REC-12 — Same candidate applies twice with an updated CV
**Steps:** a candidate sends a CV, gets rejected (say, for 2 years experience), then a week later
re-sends an updated CV claiming 8 years.
**Expected:** should probably be recognized as the same person and handled sensibly (e.g. flagged
for human review rather than silently creating a second, contradictory outcome).
**Why it matters:** there's no candidate-identity concept at all — this fires as a completely
independent `NEW_EMAIL` → independent score → independent approval/rejection, with **no linkage**
between the two submissions. Two different managers could see two unrelated approval requests for
the same person without knowing they're related.
**Status:** ⚠️ **Partial (signal added, not full de-dup)** — `ingestInbound` now counts prior
`NEW_EMAIL` CanonicalEvents from the same address and exposes `{{trigger.isRepeatSender}}` /
`{{trigger.priorSubmissionCount}}` on the trigger payload — a workflow's Approval message or
AI_STEP prompt can reference "this candidate applied before (Nx)" so a manager isn't blindsided by
an unlinked second request. This is NOT full de-duplication (no candidate-identity model, no
automatic linking/merging of the two approval requests) — that remains a real feature gap, just a
smaller one now that the fact is at least visible.

### REC-13 — Very large attachment (over the 5MB cap)
**Steps:** send a CV as an unusually large PDF (>5MB, e.g. embedded high-res photos).
**Expected:** documented, graceful degradation.
**Status:** ✅ **Fixed** — a skipped attachment (too large, unsupported type, download/parse
error, or no extractable text) is now recorded in `{{trigger.attachments}}` as
`{filename, skipped:true, skipReason}` instead of silently vanishing — visible in the run log, not
just a server log line. Live-verified generically (same mechanism as the other new tools this
session).

### REC-14 — Attachment named misleadingly
**Steps:** send a PDF resume named `invoice.pdf`, or an actual invoice named `resume.pdf`.
**Expected:** content-based, not filename-based, classification.
**Status:** ⚠️ **Partial** — extraction is based on MIME type (`application/pdf`), not filename,
so a misleadingly-named PDF still gets its text extracted correctly. A ZIP or unusual container
format, however, is not handled at all (see REC-15).

### REC-15 — Resume delivered as a ZIP attachment
**Status:** ❌ **Gap** — only direct PDF/plain-text attachments are extracted; a zipped resume is
invisible to the scorer (falls back to body/subject only, same as REC-10/11).

### REC-16 — Non-English CV/email (e.g. Hindi, or mixed English/Hindi)
**Steps:** send a CV and email body written partly or fully in Hindi.
**Expected:** GPT should still score reasonably (it's multilingual); worth confirming.
**Status:** 🧪 **Untested** this session — no non-English content was exercised in the live tests.
