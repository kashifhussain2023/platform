# Orlixa — "Meet Your AI Employees" (Video Kit)

A ~35-second showcase for the `AiEmployeesGrid` section — the 7 roles are pure motion-graphics
(text+icon cards, same as the marketing page), plus one short real-product cutaway so it doesn't read
as "just mockup cards." Copy below is the **verbatim, current** text from
`components/marketing-dark/AiEmployeesGrid.tsx` — don't paraphrase it, so the video matches the page.

---

## Shot list (timecodes)

| # | Time | Role | Icon | On-screen text (verbatim) |
|---|------|------|------|------------------------------|
| 0 | 0:00–0:03 | Intro | — | "Meet your AI workforce." |
| 1 | 0:03–0:06.5 | AI Recruiter | UserSearch (magnifier-over-person) | "Screen candidates 24/7 and shortlist the best." |
| 2 | 0:06.5–0:10 | AI Sales | TrendingUp (rising chart) | "Find leads, engage and close deals on autopilot." |
| 3 | 0:10–0:13.5 | AI Support | Headset | "Resolve customer issues instantly and intelligently." |
| 4 | 0:13.5–0:17 | AI Accountant | Calculator | "Automate bookkeeping, invoices and reports." |
| 5 | 0:17–0:20.5 | AI HR | Users | "Handle employee queries and HR processes." |
| 6 | 0:20.5–0:24 | AI Project Manager | ClipboardList | "Track tasks, timelines and keep teams aligned." |
| 7 | 0:24–0:27.5 | AI Marketing | Megaphone | "Create content, run campaigns and analyze." |
| 8 | 0:27.5–0:33 | **Real proof cutaway** | — | Quick screen-capture: open a live AI Recruiter chat, ask it a real question, watch it answer WITH a source citation shown | 
| 9 | 0:33–0:36 | Outro | — | "Hire yours in under a minute." + logo |

Card treatment: same violet-glow card style as the homepage grid (`bg-void-card`, icon in a rounded
violet-tinted tile, title bold white, body line `text-zinc-400`) — cards stagger in left-to-right, one
every ~3.5s, previous card dims to the background as the next highlights (like the Hire scene in the
How-It-Works video).

---

## Voiceover script

> Every AI employee is trained for a real job, from day one.
>
> Your AI Recruiter screens candidates around the clock and shortlists the best.
>
> Your AI Sales rep finds leads, engages, and closes deals on autopilot.
>
> Your AI Support agent resolves customer issues — instantly, and intelligently.
>
> Your AI Accountant automates bookkeeping, invoices, and reports.
>
> Your AI HR assistant handles employee questions and everyday HR work.
>
> Your AI Project Manager tracks tasks, timelines, and keeps every team aligned.
>
> And your AI Marketing employee creates content, runs campaigns, and analyzes what's working.
>
> [cutaway] And this isn't a mockup — here's one, live, answering a real question with a real source.
>
> Seven roles. One workforce. Hire yours in under a minute.

**Voice direction:** upbeat, fast-paced (~165 wpm on the role list, slows down slightly for the
cutaway line to land it as a credibility beat).
**Music:** same minimal ambient electronic bed as the other videos, energy build through the 7 cards,
settles for the real-proof cutaway, lifts again for the outro.

---

## Honesty notes

- Use these exact 7 roles/copy lines — they're the current live homepage copy, verbatim
  (`AiEmployeesGrid.tsx`). Don't add Procurement/Operations/Legal — those exist only in the backend
  marketplace catalog as generic "Custom" roles, they're not on the public marketing page.
- For the real-proof cutaway (scene 8): use a **throwaway test company**, ask the AI Recruiter a
  question that has a real knowledge-base document behind it so a genuine source citation appears —
  don't stage a fake citation.
- Separately worth fixing (not a video issue, a site bug): the homepage's "View all AI employees →"
  link currently points at `href="#"` — it goes nowhere. Worth wiring to `/register` or a real
  employees/marketplace preview before this video drives traffic to that button. Happy to fix this in
  code if you want — just ask.

## Technical specs
- 16:9 primary, 1:1 easy re-crop (each card is already a square-ish tile, stacks cleanly for social).
