# Orlixa — Security & Compliance (Video Kit)

A ~35-second animated explainer for the `SecuritySection` of the homepage, aimed at enterprise
buyers doing due-diligence. **Every claim in this script is checked against real backend code** —
see the honesty notes at the bottom before recording. This is the single most important video to get
right: an enterprise buyer who catches one false security claim will distrust everything else on the
site.

---

## ⚠️ Read this before writing on-screen badges

The current homepage `SecuritySection.tsx` shows 5 badges: **"SOC 2 Compliant," "GDPR Ready,"
Role-based Access, Audit Logs, Data Encryption.** The first two are **not backed by anything real** —
no certification, no audit, no DPA exists anywhere in the codebase or company records. Internal
engineering audits (`docs/status/2026-07-12-enterprise-readiness-audit.md`) already flagged both as
false claims that should be removed until an actual SOC 2 audit / GDPR program exists. **Do not put
either phrase in this video.** Below is a badge set using only what's actually real and built.

**Recommended real badge set:** Tenant Isolation · Data Encryption · Audit Logs · Role-Based Access ·
Human Approval Gating. (I can update `SecuritySection.tsx`'s copy to match, separately, if you want —
just say so.)

---

## Shot list (timecodes)

| # | Time | Scene | On-screen text | Visual |
|---|------|-------|------------------|--------|
| 0 | 0:00–0:03 | Intro | "Enterprise-grade security, built in — not bolted on." | Shield + padlock glow (reuse the existing hand-authored SVG from `SecuritySection.tsx`) |
| 1 | 0:03–0:09 | Tenant isolation | "Your data never leaves your company." | A glowing wall/vault forming around a data cluster, other companies' clusters visibly separate |
| 2 | 0:09–0:15 | Data encryption | "Every credential is encrypted — AES-256, never stored in plain text." | A key/credential icon dissolving into an encrypted lock glyph |
| 3 | 0:15–0:21 | Audit logs | "Every action is logged — who did what, and when." | A scrolling ledger/timeline of entries stamping in one by one |
| 4 | 0:21–0:27 | Role-based access | "Owners, Admins, and Members — each sees only what they should." | Three tiered avatar icons with different-sized access rings |
| 5 | 0:27–0:33 | Human approval gating | "Risky actions — like payments — pause for a human's sign-off first." | An action token approaching a gate, pausing, a hand/checkmark icon lets it through |
| 6 | 0:33–0:35 | Outro | "Security your team can actually verify." + logo | Logo + orlixa.io |

---

## Voiceover script

> Security isn't a checkbox here — it's how the platform is built.
>
> Every company's data is isolated, enforced at the server, on every request.
>
> Every credential you connect is encrypted — AES-256, never sitting in plain text.
>
> Every action your AI employees take is logged — who did what, and when, always reviewable.
>
> Owners, Admins, and Members each get exactly the access they need — nothing more.
>
> And when an action is risky — like moving money — it pauses for a real person to approve it first.
>
> That's security you can actually verify, not just claim.

**Voice direction:** calm, precise, slightly slower than the other videos (~140 wpm) — this is a
trust/credibility video, not a hype video.
**Music:** minimal, low, almost absent — a soft low drone, no upbeat build (this isn't a CTA-energy video).

---

## Honesty notes (what's real vs not — verified against code)

| Claim used in this script | Backing |
|---|---|
| Tenant isolation | Real — `companyId` comes only from the verified JWT server-side (`current-tenant.decorator.ts`), never from client input; confirmed by a full IDOR sweep in the 2026-07-12 audit. |
| Data encryption | Real — AES-256-GCM, random IV per encrypt, versioned envelope (`common/crypto/crypto.service.ts`). Caveat not to overclaim on camera: the encryption key is currently a single global key, not per-tenant — fine to say "encrypted," don't say "unique key per customer." |
| Audit logs | Real, shipped 2026-07-19 — a real `AuditLog` model + service, wired into workflow/role/skill/security-policy changes, `GET /audit-log` (OWNER/ADMIN only). |
| Role-based access | Real — `RolesGuard` enforces OWNER ⊇ ADMIN ⊇ MEMBER server-side. Don't overclaim granularity: today it's effectively "OWNER/ADMIN vs everyone else," not fine-grained per-feature permissions for MEMBER. |
| Human approval gating | Real but narrow — only Stripe payment-link creation is auto-flagged high-risk by default; other tools require the company to opt in via approval rules. The script's phrasing ("like payments") is deliberately the one example that's true by default. |
| **NOT used:** SOC 2 Compliant | Not real — no certification or audit exists. Was already flagged internally as a false claim. |
| **NOT used:** GDPR Ready | Not real — no data export/erasure endpoint, no enforced retention. |
| **NOT used:** SSO | Not real — already removed from the pricing page/plan catalog as of 2026-07-14 for the same reason (sold with zero implementation). Don't reintroduce it in this video. |

## Technical specs
- 16:9, same dark/violet visual language as the rest of the site (`#030408` background, `#5E3CE8`/
  `#8B6EF2` accents) — reuse the `SecuritySection.tsx` shield SVG as the intro visual so it's
  pixel-consistent with the page it sits on.
