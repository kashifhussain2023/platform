# Orlixa — Onboarding Walkthrough (Video Kit)

A ~40-second screen-capture of the REAL 3-step onboarding wizard (`/onboarding`, `features/onboarding/
components/OnboardingWizard.tsx`) — no invented UI, this is exactly what a new user sees today.
Goal: sits right after the Login video in the funnel, so a visitor sees "sign up → set up → working AI
employee" as one continuous, fast story. Reduces signup drop-off by proving it's genuinely quick.

**Recommended production method:** screen-record the real wizard (same approach as the How-It-Works
video) using a **throwaway test company** — never the real Kashif Recruiting tenant. Register a fresh
account, stop right before onboarding, then record.

---

## Shot list (timecodes)

| # | Time | Screen | What's on screen (real UI, verbatim copy) | Action |
|---|------|--------|---------------------------------------------|--------|
| 0 | 0:00–0:03 | Transition | Cuts in straight from the Login video's "success" moment | Fade from login success into the onboarding shell (split screen: illustration left, form right) |
| 1 | 0:03–0:04.5 | Onboarding shell intro | Heading: **"Let's set up your AI workforce"** · Subtitle: "A few quick steps and your first AI employees will be ready to work." · Step-dots showing 1 of 3 | Heading rises in |
| 2 | 0:04.5–0:12 | **Step 1 — Tell us about your business** | Fields: **Industry** (type e.g. "SaaS"), **Company size** (open dropdown: 1-10 / 11-50 / 51-200 / 201-1000 / 1000+ — pick one), optional description textarea | Type industry, click size dropdown, select one size, click **Continue** |
| 3 | 0:12–0:20 | **Step 2 — Which departments do you want to staff?** | Toggle-card grid: **Sales, HR, Customer support, Recruitment, Finance** | Click 2 department cards to toggle them on (e.g. Recruitment + HR), Continue lights up once ≥1 is picked, click **Continue** |
| 4 | 0:20–0:32 | **Step 3 — Choose your AI Employees** | Subtitle: "Hire from the roles that match your departments. You can rename each one now or change everything later." Shows role cards filtered to the chosen departments — e.g. **AI Recruiter** ("Sources and screens candidates, schedules interviews, and keeps your pipeline moving.") and **AI HR Assistant** ("Answers policy questions, helps with onboarding, and supports your team day to day.") | Toggle "AI Recruiter" on → a **Name** field appears pre-filled "RecruitAI" → edit it to a custom name (e.g. "Riya") → click **Finish & go to dashboard** |
| 5 | 0:32–0:37 | Dashboard | Real dashboard loads, the newly hired AI employee card is visible | Quick cut to dashboard, employee card highlighted/pulses once |
| 6 | 0:37–0:40 | Outro | "Your AI workforce, live in under a minute." + Orlixa logo (`orlixa-logo-horizontal-dark.svg`) + orlixa.io | Logo + CTA rise in |

Transitions: same 0.5s fade/slide as the How-It-Works video for visual consistency.

---

## Voiceover script

> Signing up takes seconds. Setting up takes even less.
>
> Tell us a bit about your business — your industry, your size.
>
> Pick the departments you want help with — Sales, HR, Support, Recruitment, Finance, whatever fits.
>
> Then choose your AI employees from the roles that match — give them a name, and they're ready.
>
> That's it. Your AI workforce is already on the dashboard, waiting for its first task.

**Voice direction:** brisk, confident, slightly faster pace than the How-It-Works video (~160 wpm) — the
whole point is "this was fast."
**Music:** same minimal ambient electronic bed as the How-It-Works video, ~90 BPM, for brand continuity.

---

## Honesty notes (real product, verify before recording)

- Use the **exact** 3 step names and copy above — they're pulled directly from
  `OnboardingWizard.tsx` and `onboarding.catalog.ts`, not paraphrased.
- Only 6 roles are hireable during onboarding (Recruiter, Sales Rep, Support Agent, HR Assistant,
  Accountant, Project Manager) — do **not** show "AI Marketing" being hired in this flow, it isn't in
  the onboarding catalog (it only exists in the broader post-onboarding marketplace as a custom role).
- Record on a **throwaway test company**, not the real Kashif Recruiting tenant.

## Technical specs
- 16:9 primary; re-record the same flow in a narrow browser window for a 9:16 social cut (the wizard
  layout is responsive — the illustration panel drops on narrow widths).
- Screen capture at 1920×1080, OBS Window Capture, same as the How-It-Works video setup.
