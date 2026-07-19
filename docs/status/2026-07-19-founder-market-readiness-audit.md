# V-AEP / Orlixa — What a Founder Would Flag Before Selling This

**How to read this:** Imagine an experienced business owner checking this product before selling it to a
real customer, or showing it to an investor. The real question is not "does the code work." The real
question is: "Would a customer trust this? Will it hold up once real people use it every day?"

**Date:** 2026-07-19. Checked against the actual code today. Also re-checked an older technical review from
2026-07-12, instead of just assuming it was still correct.

**Fix status:** Phases 0-3 are done — Phase 0 (Section 2), Phase 1 (Section 3), Phase 2 (Sections 4, 7, 8),
and Phase 3 (Section 5's branching/run-history/dry-run items) — see
`docs/plans/2026-07-19-founder-audit-master-plan.md` for exactly what changed and the small number of
items that still need a decision from the user (a hosting/secrets choice, an error-tracking signup, an
email-provider signup) rather than more engineering work.

---

## 1. Bottom Line

The core idea is good, and it's built well. This is not a shaky prototype. Some good signs:

- The automation engine can already do more than it looks like from the outside.
- Every company's data is kept properly separate from every other company's.
- Real payment processing (Stripe) is set up cleanly.
- In a few places, the team clearly knows how to build things the right way.

The problem: they haven't done this everywhere yet. That's fixable. It doesn't mean starting over.

But here's the honest part: **this is not ready to sell to new customers yet, beyond the one company
already using it. It's also not ready to handle many customers at once.** The biggest problems are exactly
what a buyer or an investor checks first: Is our data safe? Is there a safety net if something breaks? Are
we selling things that don't actually exist yet?

On top of that, this check found one serious bug: **a feature that shipped earlier today doesn't actually
work in a common situation — it quietly pretends to succeed instead of doing the real thing.** Fix this
one first.

---

## 2. Fix This One First

**Fixed 2026-07-19** — see `docs/plans/2026-07-19-founder-audit-master-plan.md` Phase 0.

**When a company connects an app (like Gmail) to only ONE specific AI employee — not shared by the whole
company — an automated workflow using that app quietly fakes success instead of doing anything real.**

Example: a company gives its HR AI its own Gmail inbox (`hr@company.com`), separate from its Support AI's
inbox (`support@company.com`). This works fine when a person is chatting directly with the AI. It does
**not** work inside an automated workflow — a workflow step has no way to say "use this one employee's own
inbox." So it looks for a shared, company-wide connection instead, doesn't find one, and quietly runs a
fake version that pretends it worked.

**What this means:** an automated "reply to this candidate" or "notify support" workflow says it worked and
even logs a normal-looking record — but nothing was actually sent. Nobody would know until a customer
noticed real messages never arrived, maybe weeks later. That kind of surprise can break a customer's trust
for good. Fix this as its own quick task, separate from the rest of this report.

---

## 3. Is It Solid Enough for Real Use? (Same 5 Problems as Before)

We checked the 5 big issues found on 2026-07-12. **All five are still there today**, weeks and many code
changes later:

| # | Problem | Still there? | Why it matters |
|---|---|---|---|
| 1 | Real passwords and API keys sit in a plain text settings file. The setting meant to protect sensitive data will accept a weak, made-up key with no complaint. | **Yes** | This is one of the first things any serious buyer checks. A leaked key, or weak protection on stored customer data, is a real security problem waiting to happen — not a "someday" risk. |
| 2 | Two big security features — Single Sign-On (letting big companies' staff log in through their own company system) and Audit Logs (a record of who did what, when) — are **advertised and sold** on the top plan, but **don't exist in the product at all**. | **Yes** | This is the riskiest item in this whole report. Promising a feature that doesn't exist becomes a real problem the moment a big customer asks to use it — and big customers are exactly the ones who ask. |
| 3 | No automatic testing before code changes go live. No automatic backups (just one manual one). No tool watching for errors. | **Yes** | Right now there's no safety net between "someone changes the code" and "a customer is affected." No way to know something broke except a customer complaining. |
| 4 | Every background task — checking email, running workflows, processing documents — can only handle **one thing at a time, for the whole platform, across every customer.** | **Yes** | This is a hard ceiling on how many paying customers this can support before things visibly slow down. Not a future problem — a soon problem. |
| 5 | Long lists (employees, workflows, documents) load everything at once. No "next page." No limit. | **Yes** | Works fine in a demo with a few items. Gets slow or breaks once one real customer has a lot of data. |

One good sign: the code now lives on a real remote server (like GitHub), not just one laptop — safer than
before. But that also makes problem #1 (leaked keys) matter even more, since there's now a real place for a
mistake to end up.

**One new problem, found this time:** the page where an admin asks the AI to build a workflow has no limit
on how often it can be used, or how big each request can be. Each use can trigger two real AI calls, which
cost real money. Someone could call it over and over and run up real cost, or slow things down for every
other customer sharing that same "one at a time" queue from problem #4.

---

## 4. Would a Customer Trust the Sales Pitch?

The biggest issue is the same one as #2 above: **Single Sign-On and Audit Logs are advertised as real
features on the top plan and on the marketing website — and neither one actually exists.** Everything else
here is a smaller version of the same pattern: something that looks finished on screen, but is thinner
than it looks underneath.

- **"Team" means two different things**, depending on which page you're on. One page manages real human
  logins with real permission checks. A different page (under "Organization") has its own "Teams" — just
  names, with no people actually attached. Anyone using both pages will expect them to be the same thing.
- **Inviting a teammate isn't really an invite.** Whoever adds a new person has to type in that person's
  name, email, role, **and a temporary password** — all in one form. No email is ever sent to that person.
  Beyond being clunky, having someone else set your password like this, in plain text, is a security weak
  spot — not just an inconvenience.
- **"Budget limit" on an AI employee looks real and saves properly — but does nothing.** Nothing in the
  system actually checks it. If a customer sets a $500/month cap expecting protection, and later finds
  spend went way past that with zero warning, they'd feel let down — even if nothing was promised in
  writing, the screen implies control that isn't really there.
- **Approval controls exist and genuinely work** — but only one action (creating a Stripe payment link) is
  automatically flagged for sign-off. Everything else only gets checked if a company remembers to turn it
  on. A buyer asking "can I trust this with sensitive or money actions" will find less safety net than the
  feature's name suggests.

None of this looks deliberately misleading — one part of the billing page already says plainly "coming
soon" instead of pretending something works, which is the right instinct. Apply that same honesty
everywhere else it's missing. And either build or stop advertising Single Sign-On and Audit Logs before
this goes in front of anyone who might hold the company to that promise.

---

## 5. The Automation Engine: More Powerful Than It Looks, Hard to Reach

Here's the best surprise in this report: **the automation engine can already handle "if this, then that,
otherwise this other thing" logic** — real decision branches, not just one step after another. One of the
three ready-made templates already proves this works, start to finish, today.

The problem: **neither way a customer actually builds a workflow can reach this.**

- The click-to-build editor only lets you add one step after another. There's no button anywhere to say
  "branch here — do X if true, Y if false."
- The "describe it in your own words, AI builds it" tool never tells the AI that branching is even
  possible. So no matter how someone asks, the AI can't produce one.

Today, the only way to get a workflow with real branching is to install one of the 3 ready-made templates,
or hand-edit the raw data through the API. In plain terms: **a genuinely impressive feature is already
built and paid for — it's just invisible to every normal user.** This is a real opportunity: the hard part
is done. It just needs to show up in the two places people actually build workflows.

**Other things the engine can't do yet:**

- **No repeating a step for a list of things, and no running two steps at once.** Every workflow is one
  straight line from start to end. There's a safety limit (50 steps) that stops a workflow from running
  forever by accident — but no way to say "do this for each candidate in the batch."
- **No undo, no history.** Editing a live workflow just overwrites it. No way to see what it looked like
  before, or roll back a bad change. Once customers rely on these daily for real messages, a bad edit with
  no undo is a real problem.
- **No real "just testing" mode.** Trying out a workflow before turning it on runs the exact same code as
  production — real emails get sent, real calendar invites get created. Imagine a sales demo where someone
  wants to "just try it" and it emails a real person by accident.
- **Past workflow runs aren't shown anywhere — even though the data already exists.** The system already
  keeps a record of every past run. The screen just never shows it. No page to see "what happened the last
  20 times," and no way to replay a run with the same input again. Small effort, real trust win, since the
  hard part (the data) is already there.
- **Only 3 ready-made templates exist**, covering Recruiting, Sales, and Support. The product supports six
  kinds of AI employees. Most have no ready-made automation to start from — which undercuts the "hire an AI
  employee and get value fast" pitch for every role except the one the pilot customer uses.

**What's genuinely well built here:** any outside system can trigger a workflow through a secure web
address, with no special setup needed. There's a more secure version of that for known providers. There's
a backup check every hour in case a real-time alert is missed. And if a workflow gets stuck, the system
correctly marks it as failed instead of dangerously retrying it. These hold up well under close
questioning.

---

## 6. Company Structure & Team Management: Today vs. What Growth Needs

Right now, "Company" is the only kind of account. There's no way for one account to oversee several others.
That's a reasonable choice for now — but worth naming, because **the platform's first real customer is a
recruiting agency.** Agencies are exactly the kind of customer who'd want to run this across many of
*their own* clients from one place. Today that's not possible — each client would need a fully separate
paying account with no link between them. Worth deciding this on purpose, not by accident.

Inside one company, permissions are simpler than they look. Three levels are defined (Owner, Admin,
Member) — but every real permission check in the code only ever looks for "Owner or Admin." "Member"
never gets special treatment anywhere. So in practice there are only two levels: "can change things" and
"can only look." Fine for a small team. A growing company will eventually want finer control — like
"finance can manage billing, but only the owner touches security settings."

The "Departments" and "Teams" pages under Organization are real and can be created or edited — but they're
just labels right now. There's no way to actually put a person, or an AI employee, *into* one of them
anywhere in the system. They make the org chart look complete, but they don't control who sees what, or
who's grouped with whom, yet.

There's no record anywhere of who-did-what among human users — no log of who created a workflow, changed
a role, or installed a new skill. The closest thing is a note of who approved or rejected one specific
request. For a product handling sensitive HR and recruiting data, missing a "who did this, and when" trail
is both a compliance gap, and the same broken Audit Logs promise from Section 4.

---

## 7. Budgeting: A Promise the Product Doesn't Keep Yet

Everything a customer sees about budgeting looks real, but isn't backed by anything real:

- An admin can type a dollar amount into an AI employee's "Budget limit" box, and it saves correctly.
- Nothing anywhere ever checks that number to stop spending, pause anything, or even show a warning once
  it's passed.
- There's no company-wide spending cap either — the only real limit today is how many AI employees a
  company can hire, based on their plan.
- There's no tracking yet of how much is actually being spent on AI usage per customer. The "usage" number
  on the billing page just counts activity (messages sent, tools used) — not cost. The business itself
  doesn't yet know its real cost per customer.

One good sign: the billing page is honest about this gap — it already says "usage tracking is coming soon"
instead of pretending it works. Apply that same honesty to the budget-limit box too, until it's real.

**Sensible order:** real usage/cost tracking has to come first. Everything else (enforcing a budget,
charging based on usage, telling a customer what they're spending) depends on having that number at all.

---

## 8. Subscriptions & Payments: Strong Foundation, Missing Half

This is the best-built business area in the product. Real payment processing (Stripe) is wired in
properly. A customer can genuinely upgrade or downgrade their own plan without help. And — importantly —
if a payment fails or a plan is cancelled, the system actually stops that company from hiring more AI
employees or running workflows. That's real enforcement, not just a warning banner.

What's missing is the rest of what a paying customer expects within their first month or two:

- **No way to cancel a plan yourself.** No "Cancel" button anywhere. It only cancels if done directly
  through the payment provider, not from inside the product.
- **No page for receipts or payment details.** A customer who wants to update their card or see a past bill
  has nowhere to go.
- **No warning if a payment fails.** The account quietly goes on hold — no email, no retry, no warning
  before hiring/automation gets blocked.
- **No real free-trial handling.** Trials aren't tracked separately, so there's no "your trial ends in 3
  days" reminder.

None of this is hard to build — the payment provider already offers ready-made tools for most of it (a
hosted billing page, automatic reminder emails). It just isn't connected yet. Until it is, every one of
these moments becomes a support request instead of something the customer handles themselves.

---

## 9. What's Actually Built Well

- Every company's data stays properly separate from every other company's — checked in several places,
  no leaks found.
- Hiring a new AI employee is protected against a rare timing bug (two people hiring at the exact same
  moment) — a small but real sign of careful engineering.
- Plan status (paid, overdue, cancelled) actually blocks real actions, not just a warning banner.
- The Stripe payment setup is a real, properly-built integration, not a shortcut version.
- The automation engine can do more (real branching) than its own building tools currently allow — upside
  waiting to be unlocked, not a weakness.
- The way outside systems can trigger workflows is flexible and well thought out.
- When a workflow gets stuck, the system correctly marks it failed instead of unsafely retrying it — the
  right call when real actions (like sending emails) are involved.

The pattern across this whole report: **the team clearly knows how to build the safe, correct version of
each of these things — they've already done it in a few places. What's missing is doing it everywhere
else too, not knowing how.**

---

## 10. What to Fix, in Order

**Before taking on any customer beyond the current one:**
1. Fix the workflow bug from Section 2 — it breaks a feature that just shipped today.
2. Get real passwords/keys out of the plain text settings file. Block weak encryption keys once this is
   live for real.
3. Fast-track Single Sign-On and Audit Logs, or stop advertising them until built.
4. Add page limits to every long list before one customer's data grows big enough to break it.
5. Let background tasks run more than one at a time. Add automatic retries where it's safe.
6. Add limits on how often the AI features can be called, starting with the ones that cost real money.
7. Set up automatic testing before changes go live, automatic backups, and basic error alerts.

**Before taking on many more customers, or a serious enterprise deal:**
1. Real usage/cost tracking — unlocks budget limits, usage-based pricing, and knowing the real cost per
   customer, all at once.
2. Make the budget-limit box actually work, or label it "coming soon" until it does.
3. Add self-serve cancel, past invoices, and a reminder email if payment fails.
4. Show the workflow run history that already exists but isn't displayed — small job, real trust win.
5. Add a basic record of who-did-what among human users.
6. Fix the confusing "Team" naming. Decide if Departments/Teams need real people in them, or should stay
   simple for now.

**Longer-term, once the above is solid:**
1. Let people build real branching workflows in the click-to-build editor and through the AI generator —
   unlocks a feature that's already built and paid for.
2. Consider letting one account manage several client companies — a natural fit since the first customer
   is itself an agency serving its own clients.
3. Support repeating steps and running steps at the same time.
4. Add version history and undo for workflows.
5. Build a real "just testing" mode that doesn't send real emails or create real events.
6. Add more ready-made templates, covering every type of AI employee.
7. Build finer-grained permissions beyond the current two levels.

---

## 11. Closing Thought

None of this is unusual for a product at this stage. Most of it is simply the normal gap between "a
well-built product" and "a product that's been through its first real sale and its first real growth
spurt." Writing it down like this means the list is ready on our own terms — before a customer's security
team, an investor, or an unhappy customer finds the first item on it for us.
