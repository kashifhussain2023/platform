# Slack & Google — Connector OAuth Setup Guide

How to connect a real **Slack** workspace and a real **Google** account (Gmail/Calendar/Drive) to
V-AEP, plus every issue actually hit while doing this live on 2026-07-11 and how each was fixed.
Both providers reuse the SAME generic OAuth machinery (`apps/api/src/modules/skills/oauth/`) — one
authorize-URL builder, one callback, one encrypted-token store. Only the per-provider config differs.

---

## 0. How the OAuth wiring works (read once)

- `catalog.ts` marks a skill's `connection.type` as `oauth` (vs `api_key`/`none`). Only `oauth`-type
  skills show a **"Connect"** button that redirects to the real provider consent screen.
- `oauth.providers.ts` maps each `oauth` skill → a provider (`google`, `slack`, `hubspot`,
  `atlassian`) → that provider's authorize/token URLs + scopes. Client id/secret are read from env:
  `OAUTH_<PROVIDER>_CLIENT_ID` / `OAUTH_<PROVIDER>_CLIENT_SECRET` (provider name uppercased, e.g.
  `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_SLACK_CLIENT_ID`).
- Redirect URI is always `{OAUTH_REDIRECT_BASE}/skills/oauth/callback` — **this exact URL must also
  be registered in the provider's own app dashboard**, or the provider rejects the redirect.
- `SKILL_EXECUTOR=auto` (already set) means: once an installed skill's `connectionStatus` is
  `CONNECTED`, the **real** executor is used automatically (no separate flag per skill).
- Editing `apps/api/.env` requires the API process to restart to pick up new values (in this dev
  setup it restarted on its own each time — if yours doesn't, manually stop/restart `pnpm dev`).

---

## 1. Google (Gmail / Calendar / Drive) setup

One Google OAuth client covers all three `google`-provider skills (scopes differ per skill, catalog
requests only what that skill needs).

1. https://console.cloud.google.com → create a project.
2. **APIs & Services → Enable APIs** → enable "Gmail API" (+ "Google Calendar API" / "Google Drive
   API" if using those skills).
3. **OAuth consent screen** → User type **External** → app name/support email → **Scopes**: add
   `gmail.send`, `gmail.readonly` (+ `calendar.events`, `drive.file` as needed) → **Test users**: add
   every Google account you'll connect (required while the app is in *Testing* mode).
4. **Credentials → Create OAuth client ID → Web application** → **Authorized redirect URI**:
   `http://localhost:4000/skills/oauth/callback` (local) → copy **Client ID** + **Client Secret**.
5. `apps/api/.env`:
   ```env
   OAUTH_GOOGLE_CLIENT_ID=<client id>
   OAUTH_GOOGLE_CLIENT_SECRET=<client secret>
   OAUTH_REDIRECT_BASE=http://localhost:4000
   ```
6. `/skills` page → the Gmail/Calendar/Drive card → **Connect** → sign in → approve → redirected back
   `CONNECTED`.

Full detail (inbound polling, Pub/Sub push, production checklist, SMTP fallback):
`docs/gmail-live-setup.md`.

---

## 2. Slack setup

1. https://api.slack.com/apps → **Create New App → From scratch** → name + workspace.
2. Left sidebar → **OAuth & Permissions**:
   - Scroll to **Redirect URLs** (top of page) → **Add New Redirect URL** →
     `http://localhost:4000/skills/oauth/callback` → **Add** → **Save URLs**.
   - Scroll to **Scopes → Bot Token Scopes** → **Add an OAuth Scope** → add **both** `chat:write`
     (send messages) and `channels:read` (resolve a `#channel-name` to the id `chat.postMessage`
     actually requires — see Issue #6) — add `chat:write.public` too if you want the bot to post to
     public channels without being invited.
3. Left sidebar → **Install App → Install to Workspace** → approve. (Doing this from Slack's own
   dashboard — not just saving scopes — is what actually creates the app's Bot User.)
4. Left sidebar → **App Home** → set a **Bot Display Name** if prompted (confirms the Bot User is
   configured; apps with zero bot user cause the "doesn't have a bot user to install" error below).
5. Left sidebar → **Basic Information → App Credentials** → copy **Client ID** and **Client Secret**
   (copy as *text*, not by reading a screenshot — see Issue #1 below).
6. `apps/api/.env`:
   ```env
   OAUTH_SLACK_CLIENT_ID=<client id>
   OAUTH_SLACK_CLIENT_SECRET=<client secret>
   ```
7. `apps/api/src/modules/skills/catalog.ts` — the `slack` entry's `connection` must be
   `{ type: 'oauth', label: 'Connect Slack' }` (it originally shipped as `api_key`, since the OAuth
   plumbing for Slack existed in `oauth.providers.ts` but the catalog hadn't been switched over yet —
   see Issue #4).
8. `/skills` page → Slack card → **Connect Slack** → Slack consent screen → **Allow** → redirected
   back `CONNECTED`. (If you add `channels:read` AFTER already connecting once, disconnect and
   reconnect — the old token doesn't retroactively gain the new scope.)
9. In the target Slack channel: open the channel → its name/settings → **Integrations** tab →
   **Add apps** → find your app → **Add**. (More reliable than the `/invite @bot-name` slash command,
   which needs an exact username match — see Issue #7.) Skip this if `chat:write.public` was added.
10. Find out what channels the bot can actually see (names are workspace-specific — don't assume
    `#general` exists): `POST /skills/installed/<slack-id>/tools/send_message/execute` with any
    channel name — a `not found` error lists every channel visible to the bot.
11. Test: chat with an employee that has the Slack skill assigned — *"Send a message to #&lt;a real
    channel&gt; saying hello from V-AEP"* — message should land in Slack, and the employee's chat
    panel shows the tool call.

---

## 3. Issues actually hit this session — and the fix

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Slack: `Invalid client_id parameter` | Client ID was read off a **screenshot** and mistranscribed (`115640550392...` instead of the real `11564055039205...` — one digit dropped by OCR/manual reading of a long digit string) | Always copy-paste the Client ID as **plain text** from the Slack dashboard, never retype/OCR it from an image. Re-pasted the correct value into `.env`. |
| 2 | Slack: `redirect_uri did not match any configured URIs. Passed URI: http://localhost:4000/skills/oauth/callback` | The exact callback URL was never added under Slack's **OAuth & Permissions → Redirect URLs** | Add that exact URL there and click **Save URLs** (adding it to the input box alone, without Save, doesn't persist it). |
| 3 | Slack: `Demo App doesn't have a bot user to install` | The app had a `chat:write` **bot** scope requested via our OAuth URL, but Slack hadn't created a Bot User for the app yet (scopes were saved but the app was never installed from Slack's own dashboard, and/or App Home's bot display name was never set) | Go to **Install App → Install to Workspace** directly inside the Slack dashboard once (this is what actually provisions the Bot User), and set a Bot Display Name under **App Home**. Also double-check `chat:write` is under **Bot Token Scopes**, not **User Token Scopes** — the wrong section produces the same class of error. |
| 4 | Slack "Connect" button in `/skills` saved a token that the real executor silently rejected (`"Slack not connected: expected a webhookUrl or botToken credential"`) | `catalog.ts` had `slack` marked `connection.type: 'api_key'`, so the frontend's generic single-field form stored the value as `credentials.apiKey` — but `RealSkillExecutor.slackSendMessage` only reads `webhookUrl`/`botToken`/`token`/`accessToken`. The full Slack OAuth wiring (`oauth.providers.ts`) already existed and was unused. | Switched `catalog.ts`'s slack entry to `connection.type: 'oauth'` so `/skills` renders the real OAuth-redirect flow instead of the manual field (the OAuth token exchange stores the bot token as `credentials.accessToken`, which the executor already reads). Also hardened `ConnectSkillControl.tsx` to use the `botToken` key instead of `apiKey` for any future `api_key`-type Slack fallback. |
| 5 | `.env` changes not taking effect | Expected to need a manual API restart (env vars are normally read once at process boot, unlike `.ts` changes which the watcher picks up) | In this dev setup the watcher restarted the API automatically on `.env` edits too; confirmed via the port's PID changing after each edit. If yours doesn't auto-restart, manually stop and re-run `pnpm dev` (or just the api filter) after any `.env` change. |
| 6 | Slack: `Slack API error: channel_not_found` when sending to `#hr-team` / `#general` / any `#name` | Modern Slack apps (granular OAuth scopes) reject `chat.postMessage` when `channel` is a human name — it requires the internal channel **ID** (`C0123ABCD`). Separately, the channel we guessed (`#general`) didn't even exist in this workspace. | Added automatic name→ID resolution to `RealSkillExecutor.slackSendMessage` (`resolveSlackChannelId`, via `conversations.list`) — you can keep using `#channel-name` in workflows/chat. Requires the new `channels:read` bot scope (Issue #6 continued below) and the bot must be a member of that channel (Issue #7). |
| 6b | `conversations.list failed: missing_scope` even after adding `channels:read` | The lookup requested `types=public_channel,private_channel` — Slack rejects the **whole** call as `missing_scope` when you ask for `private_channel` without also having `groups:read`, even if you do have `channels:read` for public ones | Restricted the lookup to `types=public_channel` only (matches the scope actually granted); add `groups:read` too and widen `types` if you need private-channel support |
| 7 | Slack `chat.postMessage` returns `not_in_channel` even after `/invite @<bot name>` in Slack | The bot token works and the channel resolves, but the slash-command invite either targeted the wrong app or didn't register | Use the channel's **Integrations tab → Add apps** instead of `/invite` — more reliable, confirmed to work. Or add `chat:write.public` scope + reinstall to skip needing an invite for public channels at all |

---

## 4. Other issues you may still hit (not seen yet here, but common) — and the fix

| Symptom | Likely cause | Fix |
|---|---|---|
| Slack `invalid_scope` on the authorize redirect | A scope name is misspelled, or was added under the wrong section (User vs Bot Token Scopes) | Re-check exact scope spelling (`chat:write`, `channels:read`) is listed under **Bot Token Scopes**; re-save and reinstall |
| Google consent screen shows "Access blocked: app has not completed verification" | The Google account you're connecting isn't in the **Test users** list, and the app is still in *Testing* mode (unverified) | Add that exact Google account under **OAuth consent screen → Test users**, or submit the app for Google verification to go beyond 100 test users / restricted scopes |
| Previously-connected skill starts failing to decrypt credentials after `.env` change | `ENCRYPTION_KEY` was changed after tokens were already stored — old ciphertext can't be decrypted with a new key | Disconnect and reconnect the skill after changing `ENCRYPTION_KEY`; keep the key stable across restarts in real use (real KMS/secrets manager in production) |
| OAuth works from `localhost` but fails once the app is exposed via a tunnel (ngrok/Cloudflare) | `OAUTH_REDIRECT_BASE` and the provider's registered redirect URL still point at `localhost`, but the browser is now hitting a public URL | Update `OAUTH_REDIRECT_BASE` to the tunnel's `https://` origin, add that exact URL as a new redirect URI in both Slack's and Google's app dashboards (keep the localhost one too if you still test locally) |
| `state_expired` error on the OAuth callback | The signed `state` param has a 10-minute TTL (`STATE_TTL_MS` in `oauth.service.ts`) and the consent screen was left open too long | Restart the Connect flow from `/skills` — it issues a fresh state each time |
