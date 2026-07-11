# Hiring AI Employees & Subscription Linkage — Functional Spec + Gap Analysis
**Date:** 2026-07-11 · **Scope:** Functional correctness + edge cases (design explicitly out of scope, must run end-to-end)

---

## 0. Why this document

Two questions drove this: **(1)** how does a company actually hire an AI Employee, and **(2)**
how does that tie to their subscription/billing. Investigating both surfaced the platform's
single biggest functional gap: **hiring and billing are not connected at all today.** This doc
explains both flows as they exist now, then lists every edge case that has to be closed to call
this "production functional," prioritized, no design/UI work included.

---

## Part A — How a company hires an AI Employee today

There are **3 entry points**, and all three funnel into the same one method —
`EmployeesService.create()` (`apps/api/src/modules/employees/employees.service.ts:31`):

1. **Direct hire** — `POST /employees` (`@Roles('OWNER','ADMIN')`) from the "Hire an AI employee"
   form (Name, Role, Persona). This is the screenshot you showed earlier.
2. **Onboarding wizard** — `POST /onboarding/complete` loops the selected role templates and
   calls `employees.create(companyId, {name, role})` for each one
   (`onboarding.service.ts:58`).
3. **Marketplace install** — `POST /marketplace/employees/:key/install` calls
   `employees.create(companyId, {...})` for a catalog template
   (`marketplace.service.ts:48`).

**What `create()` actually does today** (verbatim, this is the entire method):
```ts
async create(companyId, dto) {
  const employee = await this.prisma.aiEmployee.create({
    data: { companyId, name: dto.name, role: dto.role, persona: dto.persona ?? null, model: dto.model ?? null },
  });
  return toEmployeeDto(employee);
}
```
**No validation beyond the DTO shape.** No check against the company's plan, no check against
its subscription status, no de-duplication, no count limit — a company can hire 1 or 1,000
employees regardless of what they're paying for.

---

## Part B — How a company's subscription is linked today

1. **Auto-assigned at registration** — every company gets a `Subscription` row
   (`plan: STARTER, status: ACTIVE`) the moment they register, via
   `BillingService.ensureDefaultSubscription()`. This also **self-heals**: if an older company
   somehow has no subscription row, the very next `GET /billing/subscription` or
   `/billing/usage` call creates one on the fly. So "linking a subscription" is not something a
   user does explicitly today — it's automatic and invisible.
2. **Upgrading** — `POST /billing/subscription` (`@Roles('OWNER','ADMIN')`) calls
   `BillingService.changePlan()`, which delegates to the swappable `BillingProvider`:
   - **Mock** (default): switches the plan **immediately**, no payment, no external call.
   - **Stripe** (`BILLING_PROVIDER=stripe`): returns a **hosted checkout URL**; the plan does NOT
     change yet — it changes only when Stripe's webhook later confirms payment.
3. **Webhook reconciliation** — `POST /billing/webhook` (public, signature-verified) receives
   Stripe events, resolves the company by `companyId` → `externalSubscriptionId` →
   `externalCustomerId` (in that fallback order), and overwrites `plan`/`status`/`currentPeriodEnd`
   with whatever the event says.
4. **Usage snapshot** — `GET /billing/usage` computes `employees` count, `installedSkills`
   count, `tasks` (executions+messages+workflow runs), and a flag `overEmployeeLimit` — **all
   informational**, rendered only on the `/billing` page (`UsageSummary.tsx`) as a warning
   banner. Nothing reads this flag to block anything.

---

## Part C — How Hiring and Subscription connect today

**They don't.** Confirmed by grep across the entire backend: `PAST_DUE` and `CANCELED` (the two
non-healthy `SubscriptionStatus` values) are referenced **nowhere outside the billing module** —
not in employee creation, not in workflow execution, not in skill/tool execution. A company
whose card has failed (`PAST_DUE`) or who has cancelled (`CANCELED`) can still hire unlimited
employees and run everything, exactly like a paying BUSINESS customer.

This is the **#1 functional gap** — everything in Part D below flows from it.

---

## Part D — Gap Analysis (functional + edge cases, prioritized)

| # | Gap | Concrete failure scenario | Severity |
|---|-----|---------------------------|----------|
| 1 | **No hard employee-limit enforcement** | STARTER company (limit 2) hires a 3rd, 10th, 50th employee — all succeed silently. `overEmployeeLimit` only shows as a banner on `/billing`, which nobody is forced to visit. | **Critical** |
| 2 | **Limit check (once added) must be race-safe** | Two `POST /employees` calls fire concurrently when the company is at 1-of-2 (STARTER). A naive "count, then create" check lets BOTH through → 3 employees on a 2-employee plan. | **Critical** (once #1 is fixed, this must be fixed with it) |
| 3 | **`usage()` counts ALL employees, including DISABLED ones** | A company disables (retires) an employee to make room for a new hire, but the count never drops — they stay stuck at the limit forever with a "dead" employee occupying a seat. | High |
| 4 | **Subscription status not enforced anywhere** | Card fails → `status: PAST_DUE` (or a Stripe webhook sets `CANCELED`) — company keeps hiring, keeps running workflows, keeps burning LLM API cost, with zero gating. | **Critical** |
| 5 | **Downgrade has no policy** | BUSINESS (unlimited) company with 8 employees downgrades to STARTER (limit 2). Nothing happens — 8 employees keep running fine, `overEmployeeLimit` just turns on. No block, no grace period, no forced pause. **This is a genuine business-policy decision, not just a bug** — see Part F. | High |
| 6 | **Webhook events aren't idempotent/ordered** | `applyWebhookEvent` blindly overwrites plan/status with whatever the event says, with no timestamp/version check. An out-of-order redelivery (Stripe retries are at-least-once, not ordered) can revert a company from `ACTIVE` back to a stale `PAST_DUE`. | Medium |
| 7 | **ENTERPRISE is self-serve in mock mode** | `PLAN_CATALOG.ENTERPRISE` is "custom pricing" (price: null) — meant to be sales-assisted — but `MockBillingProvider.changePlan()` switches ANY company to it instantly, for free, with no gate. | Medium |
| 8 | **No trial/grace-period concept** | If the business model ever needs "14-day trial before card required," there's no `trialEndsAt` field or logic. Not urgent since STARTER is already a permanent free tier — flagged as an open question (Part F). | Low |

---

## Part E — Recommended Fix Plan (functional-only, sequenced)

All fixes are backend logic, no UI/design work required (matches your stated priority).

1. **Atomic hard-limit check in `EmployeesService.create()`** — inside a Prisma transaction,
   count **ACTIVE + PAUSED** employees (excluding DISABLED — closes gap #3), compare against
   `maxEmployeesFor(subscription.plan)`, throw `409/403` if it would exceed the limit, then
   create — all inside the same transaction so two concurrent hires can't both slip through
   (closes gaps #1 and #2). Applies uniformly to all 3 entry points since they share this method.
2. **Subscription-status gate** — same method: if `subscription.status !== 'ACTIVE'`, block the
   hire with a clear error ("Your subscription is past due — update billing to hire more
   employees"). Same gate should extend to workflow-run triggering and tool execution in a
   follow-up pass, so a cancelled company can't keep consuming paid resources (closes gap #4).
3. **Downgrade policy** (needs your decision — see Part F) — once decided, implement in
   `changePlan()`: either block the downgrade API call with a clear error listing which employees
   to disable first, or auto-pause the newest-hired employees over the new limit.
4. **Webhook idempotency** — compare incoming event's `currentPeriodEnd`/timestamp against the
   stored one; ignore (no-op) an event older than what's already applied.
5. **Gate ENTERPRISE behind a "Contact sales" flow** instead of `changePlan` in mock mode (or at
   minimum require an explicit confirmation step) — closes gap #7.

---

## Part F — Open business decisions (only you can decide these)

1. **Downgrade with over-limit employees** — pick one:
   - (a) **Block the downgrade** until the company manually disables enough employees.
   - (b) **Auto-pause** the newest hires over the new limit (reversible if they upgrade back).
   - (c) **Grandfather** — allow staying over the limit, just block *new* hires until back under.
   - *(Recommended: (c) — least disruptive, matches how most SaaS seat-limit products behave.)*
2. **Does STARTER remaining a permanent free tier need a trial/grace period at all**, or is the
   free STARTER tier itself the "trial"? (Recommended: no trial needed — current model is fine.)
3. **ENTERPRISE self-serve vs. sales-assisted** — should `changePlan` even accept `ENTERPRISE`, or
   should the UI just show a "Contact us" CTA for it?

---

## Summary

- **Hiring flow**: fully functional end-to-end (3 entry points, all RBAC'd correctly), but with
  **zero connection to billing**.
- **Subscription flow**: fully functional end-to-end (auto-assign, upgrade, webhook reconcile),
  correctly RBAC'd, but its limits are **informational only**.
- **The gap to close**: wire the two together (Part E, steps 1–2 are the critical path; 3–5 are
  hardening). This is pure backend logic — no design work — and is the highest-leverage
  "functional + edge cases" item on the platform right now.
