# Master Plan — Fixing What the Founder Audit Found

**What this is:** For every problem found in `docs/status/2026-07-19-founder-market-readiness-audit.md`,
this plan picks the single best way to fix it — given how the system is actually built today — and puts
everything in the right order. Each item says: what's wrong (short), what to actually do about it, and why
that's the best choice instead of other options.

**My recommendation up front:** Do Phase 0 and Phase 1 first, no matter what. Then do the first half of
Phase 2 (audit log + usage tracking + finishing billing) before taking on a second paying customer. Phase
3 is cheap and worth doing alongside Phase 2, not after. Phase 4 and Phase 5 can wait until there's a real
customer or deal actually asking for them — building them now would be guessing at demand that doesn't
exist yet.

---

## Phase 0 — Fix Today

**Status: done (2026-07-19).**

### The workflow bug (Section 2 of the audit)

**Problem:** A workflow can't use an AI employee's own connected app (like Gmail) — it silently fakes
success instead.

**Best fix:** Let a workflow step say which employee it should act as. Add that piece of information to
the step's settings, pass it all the way through when the step runs, and use it to find the right
connection — the employee's own one first, the shared company one if there isn't one. Also: if neither
exists, make it show a real error instead of quietly faking a result. A workflow silently pretending to
succeed is dangerous no matter which feature causes it — fixing the "quiet fake" part protects against
this same kind of bug happening again somewhere else, not just this one case.

**Why this is the right fix:** It follows the exact same pattern already used for chatting with an AI
employee, which already works correctly. Reusing a pattern that's already proven, instead of inventing a
new one, is both faster and safer.

---

## Phase 1 — Foundation (before taking on a second paying customer)

**Status: mostly done (2026-07-19).** Everything that was pure code is done and verified. Two pieces
specifically need YOU to make a decision or create an account — I can't do those on my own — flagged below
under item 1 and item 2.

These are the "make sure the building doesn't fall down" items. They get more expensive to fix the more
customers are depending on the system, so do them now while there's still just one.

### 1. Real passwords/keys sitting in a plain settings file

**Status: half done.** Code fix is in: the app now refuses to start in production with no encryption key,
or with an obviously fake one (a repeating pattern or too few unique bytes — the exact placeholder found
in `.env` would now be rejected). **Still needs you:** actually rotating (replacing) the real API keys and
picking where secrets live in production. I don't know which hosting provider this will run on, so I can't
set up its secrets manager for you — once you pick one (or if you're not sure which, tell me and I can
recommend one for your setup), moving the real values there and rotating them is a quick follow-up.

**Best fix:** Move real secrets out of the settings file and into your hosting provider's own secrets
storage (most hosting platforms have one built in — this avoids buying/learning a separate tool). Add one
check at startup that refuses to run if the encryption key looks fake or too simple. Also rotate
(replace) the real keys that have been sitting there, since a key that's been exposed on disk, even
briefly, should be treated as if it might already be compromised.

**Why:** This is the cheapest possible fix (a few hours of work) for the single riskiest item in the whole
report. No reason to wait.

### 2. No automatic testing, no automatic backups, no error alerts

**Status: 2 of 3 done.** GitHub Actions (automatic testing) and the automated backup script are both done
and verified working. **Still needs you:** the error-alert tool. Adding one (e.g. Sentry or similar) needs
an account and a project key that only you can create — once you have one, wiring it in is quick.

**Best fix:** Three small, separate things, not one big project:
- Turn on GitHub's free built-in automation (Actions) to run the existing tests automatically every time
  code changes — the tests already exist, they just don't run themselves yet.
- Set up a nightly automatic backup of the database — a scheduled task, not a manual one someone has to
  remember to run.
- Add a free or low-cost error-tracking tool (many exist and take under an hour to wire in) so a broken
  feature shows up as an alert instead of a customer complaint.

**Why:** All three use tools that already exist and are cheap — this isn't about building anything new,
just turning on safety nets that are standard for any real product.

### 3. Background tasks can only do one thing at a time

**Status: done.**

**Best fix:** Let each task type (checking email, running workflows, processing documents) handle several
things at once instead of just one — a small settings change, not a redesign. Start with a modest number
(handling maybe 5-10 at a time instead of 1) and watch how it behaves before raising it further.

**Why:** Raising this slowly and watching what happens is safer than guessing a big number up front —
some of these tasks talk to outside services (like Gmail) that have their own limits, so it's better to
raise this gradually.

### 4. No limit on long lists

**Status: done** (a cap with a sensible default, not a full "click for next page" screen yet — that's a
smaller follow-up if you want it; the part that actually protects against a slowdown/crash is done).

**Best fix:** Add "give me items 1-50, then the next 50" to every long list (employees, workflows,
documents, connections) instead of loading everything at once. One part of the system already does this
correctly — copy that exact same pattern everywhere else instead of inventing a new one.

**Why:** Reusing a pattern that's already built and already working means less new code and less risk of
getting it wrong the second time.

### 5. No limit on how often expensive features can be called

**Status: done.**

**Best fix:** Add a call limit to the AI-related features first (the ones that cost real money per use),
using a well-known, ready-made tool for this rather than building limit-tracking from scratch. Add it to
login/signup too, since that was flagged before and still isn't done.

**Why:** This protects both the wallet (real AI costs) and the whole system (one user can't slow things
down for everyone else) — and the tool needed for this is a standard, drop-in one, not custom work.

---

## Phase 2 — Trust & Money (before scaling past a handful of customers)

**Status: done (2026-07-19).** One real gap remains that needs the user, not more of my work: actual EMAIL
delivery on a payment failure — see item 9.

### 6. Selling "Single Sign-On" and "Audit Logs" that don't exist

**Status: done.** Audit Logs built (a real, if minimal, who-did-what trail). SSO removed from both the
backend plan catalog and the marketing homepage's pricing section, rather than built speculatively.

**Best fix:** Split this into two different decisions, since they're not equally urgent:
- **Audit Logs — build a light version now.** Add one simple table that records "who did what, when" for
  the most important actions (created a workflow, changed a role, installed a connection). This is a
  small, cheap piece of work, and it directly fixes the compliance gap and the "who did this" gap found in
  a few other places in the audit too — one fix, several problems solved.
- **Single Sign-On — don't build it yet. Take it off the price list instead**, until an actual enterprise
  customer specifically asks for it and is ready to pay for it. Single Sign-On is genuinely complex to
  build well and has very little value until a customer with that exact need shows up — building it on
  spec is a guess, not a plan.

**Why:** This gets rid of the "selling something that doesn't exist" risk today, at almost no cost (just
editing the price list), while still building the one piece (Audit Logs) that's cheap and has value on
its own regardless of who's selling.

### 7. Nobody knows how much AI usage actually costs

**Status: done.**

**Best fix:** Every AI call in the whole system already goes through one shared piece of code. Record how
much each call costs, right at that one spot, tagged with which company and which employee made the call.
Store it, and show a running total on the billing page instead of just the loose "activity count" that's
there now.

**Why:** Because every AI call already funnels through one place, this is a single, contained change — not
a hunt through the whole codebase. And it's the one piece everything else in this section depends on.

### 8. "Budget limit" on an employee does nothing

**Status: done** (real block, not a two-stage warn-then-block -- there's no notification channel yet to
deliver a "warning" through, so a clear error at the point of use is the honest equivalent today).

**Best fix:** Once real cost tracking exists (item 7), check an employee's running cost against their
budget limit right before letting them do anything that costs money. Don't cut them off instantly the
first time they're over — send a warning first, then block if it keeps happening. Until cost tracking
exists, add a small note next to the budget-limit box saying "enforcement coming soon," so it stops
implying protection that isn't there yet.

**Why:** This can't be built correctly before item 7 exists — trying to enforce a budget without knowing
real cost would just be guessing. The "warn first, then block" approach avoids surprising a customer with
a sudden hard stop.

### 9. Billing is missing self-serve cancel, invoices, and payment-failure emails

**Status: half done.** Stripe's hosted billing portal (cancel/invoices/payment method) is wired up. **Still
needs you:** actual EMAIL delivery on a payment failure needs an email-provider account (SendGrid, Postmark,
SES, etc.) this repo doesn't have — the failure itself is now durably recorded (an audit-log entry) the
moment it happens, so nothing is silently lost; it just isn't emailed to anyone yet. Once you pick a
provider, wiring the send is a quick follow-up.

**Best fix:** The payment provider already being used (Stripe) has a ready-made page for exactly this —
letting a customer see invoices, update their card, and cancel, without building any of those screens
yourself. Turn that on instead of building a custom version. For payment failures: Stripe already sends a
signal when a payment fails — just add an email that fires off that signal, since that hookup is the one
piece currently missing.

**Why:** Building custom invoice/cancel screens would be reinventing something Stripe already gives away
for free — using their ready-made page is both less work and more reliable.

---

## Phase 3 — Quick Wins (cheap, do alongside Phase 2, not after)

### 10. The automation engine can already do "if this, then that" branching — but nobody can reach it

**Best fix:** Two small, separate fixes:
- In the click-to-build editor, add one small option on the decision-check step: "add a Yes path and a No
  path." The underlying engine already fully supports this — this is just giving people a button to use
  it.
- In the "describe it, AI builds it" tool, simply tell the AI (in its instructions) that branching exists
  and how to describe it. No new engine work at all — just teaching the AI about a feature it doesn't know
  about yet.

**Why:** This is the single highest-value-for-effort fix in the whole report. The hard, expensive part
(the engine actually supporting branching) is already done and paid for. This just makes it visible.

### 11. Past workflow runs aren't shown anywhere

**Best fix:** The system already keeps this history and already has a working way to fetch it — it just
isn't shown on any screen. Add a simple "past runs" list to the workflow page using what already exists.

**Why:** This is close to the cheapest possible fix in this whole plan — the data and the fetching code
are already built. It's purely a missing screen.

### 12. No safe way to test a workflow before turning it on

**Best fix:** Add a "test mode" switch to running a workflow. In test mode, instead of actually sending the
email or creating the calendar event, it shows "this would have sent an email saying X" — a preview, not
the real action.

**Why:** This directly protects against the exact "oops, it emailed a real person during a demo" risk
raised in the audit, and it's a contained, well-scoped change to one part of the engine.

---

## Phase 4 — Structural Cleanup (moderate effort, once Phase 1-3 are solid)

### 13. "Team" means two different things depending on the page

**Best fix:** Rename the confusing one. The Organization page's memberless "Teams" tab should be called
something else (like "Groups" or "Labels") so it stops competing with the real Team/Users page for the
same name.

**Why:** This is a naming fix, not a feature change — cheap, and removes the confusion immediately without
needing to decide yet whether "Groups" should get real members later.

### 14. Inviting a teammate uses a plaintext temporary password

**Best fix:** Switch to a proper email invite: generate a one-time secure link, email it to the new person,
and let them set their own password when they click it. This needs the ability to send emails from the
product, which doesn't fully exist yet — so this should be scheduled together with (or right after)
whatever work adds real email-sending, rather than done in isolation.

**Why:** A one-time link the person clicks themselves is the standard, secure way to do this — it removes
the plaintext-password problem entirely rather than patching around it.

### 15. Only two permission levels really exist (not three)

**Best fix:** Don't build a full fine-grained permission system yet — that's a lot of work without a
customer specifically asking for it. Instead, make the existing third level ("Member") actually mean
something small and real: read-only access, properly enforced, instead of being unused. That's a much
smaller step that closes the gap without over-building.

**Why:** Building a full permissions matrix on a guess is exactly the kind of speculative work worth
avoiding until real demand shows up — a small, real step now is safer than a big, unused system later.

---

## Phase 5 — Bigger Bets (only once there's a clear signal — a real deal or a real customer asking)

These are all real, valuable ideas — they're just bigger, and building them without a customer actively
asking for them is a guess about the future rather than a response to the present. Recommended approach for
each, to use whenever the signal shows up:

- **One account managing several client companies** (the agency/reseller idea) — worth doing specifically
  because the current pilot customer is itself an agency, so this isn't a hypothetical need. But it's a
  real structural change (a company would need to "belong to" another company), so wait until an actual
  agency customer is ready to pay for it before building it.
- **Repeating a step for a list of items, and running steps at the same time** — real workflow-engine
  additions. Worth doing once customers start asking for "do this for every candidate," not before.
- **Undo/history for workflow edits** — keep the last several versions of a workflow's definition so a bad
  edit can be reversed. A moderate, well-contained addition once workflows are being edited often enough
  that this becomes a real pain point.
- **More ready-made templates** — cheap to add one at a time as new customer types show up (Sales, Support,
  HR, etc.), rather than trying to build all of them speculatively now.
- **A full fine-grained permission system** — revisit once "Member" being real-but-basic (Phase 4, item 15)
  isn't enough for a specific customer's needs.

---

## Why This Order, Specifically

Phase 0 comes first because it's a live bug in something that shipped today — waiting makes it worse, not
better. Phase 1 comes next because every item in it gets harder and riskier to fix the more real customer
data and real customer trust is riding on the system — these are exactly the things that are cheap to fix
now and expensive to fix later. Phase 2 comes before scaling because usage tracking, a real audit trail,
and finished billing are the three things a growing number of paying customers will directly expose as
missing — better to have them ready than to build them reactively under pressure. Phase 3 rides alongside
Phase 2 because it's genuinely cheap and turns already-built, already-paid-for capability into something
customers can actually use and see — there's no reason to delay work this affordable. Phase 4 and 5 are
last on purpose: they're valuable, but building them without a real customer or deal asking for them risks
guessing wrong about what's actually needed — better to let real demand decide the order there, not
assumption.
