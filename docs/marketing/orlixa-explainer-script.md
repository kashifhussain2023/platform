# Orlixa — Product Explainer Video Kit

A ~68-second product walkthrough: **Hire → Skills → Knowledge → Workflows → Approvals → Measure**.
Two ways to produce the final MP4:

1. **Screen-record the built animation** (recommended — pixel-accurate, on-brand). Route: **`/demo`**.
2. **Generate with an AI video tool** using the voiceover script + per-scene prompts below.

---

## 1. Record the built animation (fastest, on-brand)

The `/demo` route is a self-playing, dark-violet animated explainer built from the real product
design system (same logo, colors, components). It runs once (~68s) then shows a **Replay** button.

**Steps**
1. Run the app (`pnpm dev`) and open **`http://localhost:3000/demo`** in Chrome.
2. Set the browser to a clean 1920×1080 (full-screen, or use DevTools device toolbar → Responsive → 1920×1080).
3. Record with **OBS Studio** (free) or Chrome's built-in capture / Loom / ScreenStudio:
   - OBS → Sources → *Window Capture* (the Chrome tab) → Start Recording.
   - Refresh the tab to restart the animation from the intro, let it play to the outro, Stop.
4. (Optional) Add the voiceover (section 3) + background music in any editor (CapCut, Premiere, Resolve).

**Handy URLs**
- `?scene=N` freezes on one scene (0 = intro … 7 = outro) — great for stills, thumbnails, or re-recording a single step.
- Scenes auto-advance; total ≈ 68.5s.

---

## 2. Storyboard / shot list (timecodes)

| # | Time | Scene | On-screen | Visual / transition |
|---|------|-------|-----------|---------------------|
| 0 | 0:00–0:04.5 | Intro | Orlixa logo · "AI Workforce Platform" · "Build your AI workforce — in six simple steps." | Logo pops in, text rises. |
| 1 | 0:04.5–0:13.5 | Hire | "01 HIRE · Hire an AI Employee" + config chips (Role, Name, Working hours, Owner) | Role grid staggers in; AI Recruiter highlights + "✓ Hired" badge. Cross-fade. |
| 2 | 0:13.5–0:22.5 | Skills | "02 SKILLS · Grant Skills" + chips (Slack, Gmail, Calendar, Stripe, 40+ more) | Employee node center; skill icons pop around it one by one. |
| 3 | 0:22.5–0:31.5 | Knowledge | "03 KNOWLEDGE · Brief with Knowledge" + chips (PDFs, Docs, Price lists, Past tickets) | Doc cards stack in; "Answer + cite" chip appears. |
| 4 | 0:31.5–0:42.0 | Workflows | "04 WORKFLOWS · Chain into Workflows" + chips (Trigger, AI step, Condition, Approval, Notify) | Nodes slide in top→bottom; "Qualified?" condition highlighted. |
| 5 | 0:42.0–0:51.5 | Approvals | "05 APPROVALS · Gate with Approvals" + chips (Spend limits, Risky tools, Reviewers) | Approval card; Approve button pulses green, check pops. |
| 6 | 0:51.5–1:00.5 | Measure | "06 MEASURE · Measure & scale" + chips (KPIs, Goals, Alerts) | Four metric tiles stagger in (1,248 · 98.6% · 312 · 2.4h). |
| 7 | 1:00.5–1:08.5 | Outro | "Start building your AI workforce." · "Hire your first AI Employee" · orlixa.io | Logo + CTA rise in. |

Transitions between scenes: 0.55s fade + slight scale/slide (ease `cubic-bezier(.22,1,.36,1)`).

---

## 3. Voiceover script (clean, for TTS — e.g. ElevenLabs / PlayHT)

> **Intro.** Meet Orlixa — the AI Workforce Platform. Build your AI workforce in six simple steps.
>
> **Step one — Hire.** Pick a role from the marketplace: Recruiter, Sales, Support, and more. Each AI
> employee arrives pre-trained and ready for duty in minutes — just set a name, working hours, and an owner.
>
> **Step two — Grant Skills.** Connect the tools your employee needs: Slack, Gmail, Calendar, Stripe, and
> forty more. Every skill is scoped and revocable in a single click.
>
> **Step three — Brief with Knowledge.** Upload your playbooks, docs, and past tickets. Now every answer
> stays grounded in your business — always with a citation back to the source.
>
> **Step four — Chain into Workflows.** Compose steps on a visual canvas: a trigger, an AI step, a
> condition, an approval. Work hands off between employees automatically, around the clock.
>
> **Step five — Gate with Approvals.** Set spend limits and sensitive actions. When an employee needs
> sign-off, it waits for one human tap — and every action is logged for audit.
>
> **Step six — Measure & scale.** Track tasks completed, hours saved, and approval times on your
> dashboard. Then clone what works and grow your workforce.
>
> **Outro.** That's Orlixa. Start building your AI workforce today — at orlixa dot io.

**Voice direction:** confident, warm, modern tech brand; ~150 wpm; small pause between steps.
**Music:** minimal ambient electronic, ~90 BPM, subtle build into the outro (e.g. Artlist/Epidemic "future/tech" beds).

---

## 4. AI video-tool prompts (alternative / for extra b-roll)

Text-to-video tools (Runway Gen-3, Pika, Luma, Sora, Google Veo) are best for **atmospheric b-roll**
behind the voiceover; for exact product UI, prefer the `/demo` recording. Shared style suffix:

> **Style:** ultra-modern dark SaaS aesthetic, near-black background (#050408), electric violet/indigo
> accents (#5E3CE8, #8B6EF2), soft volumetric glow, glassmorphism, subtle particles, smooth cinematic
> camera, 16:9, high detail, no text, no logos.

- **Intro b-roll:** "A glowing violet neural network slowly forming the silhouette of a human head from
  particles of light, dark space, gentle drift." + style.
- **Hire:** "Sleek holographic employee ID cards materializing and slotting into place on a dark glass
  console, one highlighted with a violet checkmark." + style.
- **Skills:** "A central glowing node connecting to floating app tiles with thin light beams switching on
  one by one." + style.
- **Knowledge:** "Documents dissolving into a lattice of glowing violet data points, one beam tracing back
  to a highlighted page." + style.
- **Workflows:** "An automated pipeline of glowing nodes and connectors assembling left to right, a pulse
  of light travelling through it." + style.
- **Approvals:** "A single action token pausing at a glowing gate, a soft green ring of approval expanding."
  + style.
- **Measure:** "A minimalist dashboard with rising line charts and counting numbers glowing violet on dark
  glass." + style.
- **Outro:** "A luminous ringed 'O' mark with a violet comet sweep and a spark, centered in dark space." + style.

**Avatar/presenter option (HeyGen / Synthesia):** paste the section-3 script, pick a professional
presenter + violet-tinted background, and overlay the `/demo` recording as picture-in-picture for the
step visuals.

---

## 5. Aspect-ratio variants
- **16:9** (default) — YouTube, website hero, sales decks.
- **1:1 / 9:16** — for social, re-record `/demo` in a square/portrait window and let text/visuals stack
  (the layout is responsive; steps go single-column on narrow widths).
