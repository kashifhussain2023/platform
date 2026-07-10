# Gmail — Live Setup Guide (production-level test)

**Goal:** connect a real Gmail account to V-AEP so RecruitAI can **send real email** (and, with the inbound driver, react to **incoming email**).

> **Key fact:** Gmail is **OAuth-based**. The email address alone is NOT a credential. You must create a Google Cloud OAuth client and complete the browser consent once per Gmail account. The platform never sees the Gmail password.

---

## 0. What is already set up (done for you)
- Company **Kashif Recruiting** (`kashif-recruiting`), timezone Asia/Kolkata.
- Logins (password `Kashif@V-AEP2026` — change after first login):
  - OWNER `kashifhussain146@gmail.com`
  - ADMIN `kashifhussain.jaipur@gmail.com`
- **RecruitAI** (RECRUITER) with the **gmail** + **calendar** connectors assigned; `approvalRules` require approval for `gmail:send_email` (safe first live test).
- **Gmail connector** installed, `connectionStatus = NOT_CONNECTED`, id `cmrf5if09000dcs6wxw8zuwcw`.
- An **ACTIVE workflow** with an `EVENT` trigger on `NEW_EMAIL` (what a live inbound email will drive).

You supply the Google OAuth config below → click Connect → it goes live.

---

## 1. Google Cloud (one-time, ~10 min)
1. **Create a project** at https://console.cloud.google.com.
2. **Enable APIs** → "Gmail API" (and "Cloud Pub/Sub API" **only if** you want real-time inbound push — see §5).
3. **OAuth consent screen** → User type **External** → fill app name/support email → **Scopes**: add
   - `https://www.googleapis.com/auth/gmail.send` (send)
   - `https://www.googleapis.com/auth/gmail.readonly` (read inbox — for inbound)
   → **Test users**: add **both** `kashifhussain146@gmail.com` and `kashifhussain.jaipur@gmail.com` (while the app is in *Testing* mode Google only allows listed test users; otherwise consent is blocked).
4. **Credentials → Create OAuth client ID → Web application.**
   - **Authorized redirect URI** = `{OAUTH_REDIRECT_BASE}/skills/oauth/callback`
     - Local: `http://localhost:4000/skills/oauth/callback`
     - Public/tunnel: `https://<your-domain-or-ngrok>/skills/oauth/callback`
   - Copy the **Client ID** and **Client Secret**.

---

## 2. Platform env (`apps/api/.env`) — then restart the API
```env
OAUTH_GOOGLE_CLIENT_ID=<from step 1.4>
OAUTH_GOOGLE_CLIENT_SECRET=<from step 1.4>
OAUTH_REDIRECT_BASE=http://localhost:4000     # MUST exactly match the redirect URI base in Google
SKILL_EXECUTOR=auto                            # real executor when a connector is CONNECTED, else mock
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef   # same key used to seed; use a real 64-hex key in prod
# already present: DATABASE_URL (…5433), REDIS_URL (…6380), JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, WEB_ORIGIN
```
Restart: `pnpm --filter @vaep/api dev` (or `pnpm dev` for web+api). `WEB_ORIGIN` must match where you open the app (default `http://localhost:3000`).

> **ENCRYPTION_KEY must match the one used when the connector was seeded** (above), or previously stored tokens won't decrypt. For a clean start you can disconnect/reconnect after setting your own key.

---

## 3. Connect the Gmail account (consent)
1. `pnpm dev` → open http://localhost:3000 → log in as `kashifhussain146@gmail.com`.
2. **Skills** page → Gmail connector → **Connect** → you're redirected to Google → sign in as the Gmail account → approve the scopes.
3. Google redirects back to `/skills/oauth/callback` → the platform exchanges the code, **encrypts + stores the tokens**, sets `connectionStatus = CONNECTED`.
4. (Optional) repeat logged in as / for the second Gmail account to add a second connector.

Verify: `GET /connectors/:id/health` → `CONNECTED`; `credentialsSet: true` (raw tokens never exposed).

---

## 4. Test OUTBOUND (works today once connected)
The `RealSkillExecutor` sends via the **Gmail API** using the OAuth token. Because RecruitAI is approval-gated on `gmail:send_email`:
1. Open RecruitAI chat → *"Email `kashifhussain.jaipur@gmail.com` a Senior Backend interview invite for Friday 3pm."*
2. It creates a **PENDING approval** (no send yet) → open **/approvals** → **Approve** → a **real email is sent** from the connected Gmail account (a `SkillExecution` is logged).
3. To auto-send without approval, remove `gmail:send_email` from the employee's `approvalRules`.

✅ This is a genuine production send path (OAuth + Gmail API + token refresh + encrypted storage + approval + audit).

---

## 5. Test INBOUND (new email → workflow) — honest status
Detecting *incoming* Gmail in real time is the one piece **not yet built** (`[TARGET]` in the architecture doc). Gmail's model is `users.watch → Google Cloud Pub/Sub → your push endpoint` (the notification is thin → then `users.history.list`). Three ways to test inbound:

| Option | What it needs | Reality |
|---|---|---|
| **A. Manual/simulated event** (works now) | nothing | `POST /workflows/events { "eventType":"NEW_EMAIL", "payload":{ "role":"Senior Backend", "from":"cand@x.com" } }` → drives the ACTIVE workflow immediately. Best for testing workflow logic today. |
| **B. Polling driver** (I can build) | Gmail `gmail.readonly` scope; a scheduled poll of new messages via `historyId` cursor → normalize → `fireEvent(NEW_EMAIL)` | No public URL needed — simplest true-inbound for local. |
| **C. Push driver** (I can build, production-grade) | Cloud Pub/Sub topic + `users.watch` (renew ≤7 days) + a **public HTTPS** push endpoint (`/connectors/:id/webhook`) | Real-time, lowest latency; needs a public URL (ngrok/Cloudflare Tunnel locally). |

The **connector ingestion pipeline, normalization, and the `NEW_EMAIL`→workflow path already exist** — only the Gmail-specific *driver* (watch/poll → CanonicalEvent) is pending. Say the word and I'll implement **Option B or C**.

---

## 6. Public HTTPS for local (needed for real OAuth callback from a non-localhost, and for push)
`localhost` redirect works for OAuth from your own browser. For push webhooks (Option C) or testing from outside, expose the API:
```
ngrok http 4000     # or: cloudflared tunnel --url http://localhost:4000
```
Then set `OAUTH_REDIRECT_BASE=https://<id>.ngrok.app`, add that redirect URI in Google, and use the same base for the connector webhook URL.

---

## 7. Going to production
- Move the OAuth app **Testing → In production** (Google **verification** is required for restricted Gmail scopes when serving external users beyond test users).
- Real `ENCRYPTION_KEY` from a **KMS/Secrets Manager**; rotate.
- Stable **HTTPS domain**; Pub/Sub for inbound; **token refresh** (single-flight — already implemented) keeps sends working as access tokens expire.
- Per-connector **rate limits** (already implemented) respect Gmail send quotas; watch/subscription **renewal** job for inbound.

---

## Alternative (quickest live send, less "correct"): SMTP + App Password
If you want to send a real email in 5 minutes without a Google Cloud project: enable 2-Step Verification on the Gmail account → create an **App Password** → send via Gmail **SMTP** (`smtp.gmail.com:465`). Our executor currently uses the **Gmail API (OAuth)**, not SMTP, so this needs a small `gmail-smtp` executor variant — I can add it if you prefer this path for a fast smoke test. OAuth (above) is the production-correct route.
