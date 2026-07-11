#!/usr/bin/env node
/**
 * harness.mjs — shared helpers for the edge-case-test scripts under
 * scripts/edge-case-tests/<category>/. One scenario = one small script that
 * imports what it needs from here; keeps every scenario script short and
 * focused (per docs/test-cases/*.md — each script mirrors one documented
 * scenario id, e.g. WF-A2, REC-06).
 *
 * Node 22 (global fetch/FormData/Blob/readline/promises), ESM. The API must
 * already be running (`pnpm dev` from `platform/`, or a temp instance) — see
 * platform/CLAUDE.md for the boot env. Defaults to http://localhost:4000;
 * override with BASE=... in the environment.
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export const BASE = process.env.BASE || 'http://localhost:4000';

// --- console reporting -------------------------------------------------

const color = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
export const log = (...a) => console.log(...a);
export const section = (title) => log(`\n${color('36;1', `=== ${title} ===`)}`);
export const info = (msg) => log(color('90', `  · ${msg}`));
export const pass = (label, detail = '') =>
  log(color('32;1', `  ✔ PASS`), label, detail ? color('90', `— ${detail}`) : '');
export const fail = (label, detail = '') =>
  log(color('31;1', `  ✘ FAIL`), label, detail ? color('90', `— ${detail}`) : '');
export const warn = (msg) => log(color('33;1', `  ⚠ ${msg}`));

/** Assert `cond`; prints PASS/FAIL and tracks a process-wide tally. */
const tally = { pass: 0, fail: 0 };
export function assert(cond, label, detail = '') {
  if (cond) {
    tally.pass += 1;
    pass(label, detail);
  } else {
    tally.fail += 1;
    fail(label, detail);
  }
  return cond;
}
export function summary() {
  section('Summary');
  log(`  ${color('32;1', `${tally.pass} passed`)}, ${tally.fail > 0 ? color('31;1', `${tally.fail} failed`) : '0 failed'}`);
  if (tally.fail > 0) process.exitCode = 1;
}

// --- interactive prompts (for scenarios needing REAL user input, e.g. an --
// --- actual email send that no script can do on the user's behalf) -------

const rl = readline.createInterface({ input: stdin, output: stdout });

/**
 * Print a guided instruction block, then wait for the user to press Enter
 * once they've done it. Used by scenarios that need a REAL action outside
 * the API (sending an email from a real inbox) — the script can't do this
 * itself, so it tells the user exactly what to send and pauses.
 */
export async function guide(instructions) {
  log(`\n${color('35;1', '>>> YOUR TURN — do this now:')}`);
  for (const line of instructions) {
    log(color('35', `    ${line}`));
  }
  await rl.question(color('90', '\n    Press Enter once done... '));
}

export async function ask(question) {
  return rl.question(color('36', `${question} `));
}

export function closePrompt() {
  rl.close();
}

// --- HTTP -----------------------------------------------------------------

export function makeClient(initialToken) {
  let token = initialToken ?? null;
  async function req(method, path, body, opts = {}) {
    const headers = {};
    const useToken = opts.token !== undefined ? opts.token : token;
    if (useToken) headers.Authorization = `Bearer ${useToken}`;
    let payload;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    if (opts.raw) return { status: res.status, json };
    if (!res.ok) {
      const err = new Error(
        `${method} ${path} -> ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`,
      );
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }
  return {
    get: (p, o) => req('GET', p, undefined, o),
    post: (p, b, o) => req('POST', p, b, o),
    patch: (p, b, o) => req('PATCH', p, b, o),
    delete: (p, o) => req('DELETE', p, undefined, o),
    setToken: (t) => { token = t; },
    getToken: () => token,
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function poll(fn, { tries = 40, delayMs = 500, label = 'condition' } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const result = await fn();
    if (result !== undefined && result !== null && result !== false) return result;
    await sleep(delayMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

// --- scenario setup helpers -------------------------------------------------

/** Register a fresh THROWAWAY company (never the real Kashif tenant) — see
 * memory "protect-real-tenant-data". Returns a ready-to-use client + ids. */
export async function freshCompany(namePrefix) {
  const anon = makeClient(null);
  const suffix = Date.now();
  const email = `${namePrefix.toLowerCase().replace(/\s+/g, '-')}-${suffix}@example.com`;
  const res = await anon.post('/auth/register', {
    companyName: `${namePrefix} ${suffix}`,
    name: 'Test Owner',
    email,
    password: 'password123',
  });
  const client = makeClient(res.tokens.accessToken);
  return { client, companyId: res.company.id, email, password: 'password123' };
}

/** Log in to the REAL, standing Kashif Recruiting test tenant. */
export async function kashifCompany() {
  const anon = makeClient(null);
  const res = await anon.post('/auth/login', {
    email: 'kashifhussain146@gmail.com',
    password: 'Kashif@V-AEP2026',
  });
  const client = makeClient(res.tokens.accessToken);
  return { client, companyId: res.company.id };
}

export async function hire(client, { name, role, persona }) {
  return client.post('/employees', { name, role, persona });
}

export async function installSkill(client, skillKey) {
  return client.post('/skills/install', { skillKey });
}

export async function assignSkill(client, employeeId, installedSkillId) {
  return client.post(`/employees/${employeeId}/skills`, { installedSkillId });
}

/** Chat with an employee: creates a fresh conversation, sends one message. */
export async function chat(client, employeeId, content) {
  const conv = await client.post(`/employees/${employeeId}/conversations`, {});
  return client.post(`/conversations/${conv.id}/messages`, { content });
}

// --- Recruiter-category helpers (real Gmail on the standing Kashif tenant) --

/** Find a workflow by a case-insensitive name substring (e.g. "candidate email"). */
export async function findWorkflowByName(client, nameSubstring) {
  const list = await client.get('/workflows');
  const match = list.find((w) => w.name.toLowerCase().includes(nameSubstring.toLowerCase()));
  if (!match) throw new Error(`No workflow found matching "${nameSubstring}"`);
  return match;
}

/** Find the CONNECTED gmail connector (installed skill) for the current company. */
export async function findGmailConnector(client) {
  const skills = await client.get('/skills/installed');
  const match = skills.find((s) => s.skillKey === 'gmail' && s.connectionStatus === 'CONNECTED');
  if (!match) throw new Error('No CONNECTED gmail connector found for this company');
  return match;
}

/** Trigger an immediate Gmail poll (instead of waiting for the ~60s scheduler). */
export async function pollConnectorNow(client, connectorId) {
  return client.post(`/connectors/${connectorId}/poll`, {});
}

/**
 * Wait for a NEW WorkflowRun on `workflowId` created after `sinceMs` (and not
 * already in `excludeIds`, for scripts calling this repeatedly to pick up
 * several distinct emails one at a time), then wait for IT to reach a
 * terminal (or WAITING) status. Polls the Gmail connector each cycle so it
 * doesn't wait the full ~60s scheduler interval.
 */
export async function waitForNewRun(client, workflowId, connectorId, sinceMs, opts = {}) {
  const excludeIds = opts.excludeIds ?? new Set();
  const run = await poll(
    async () => {
      if (connectorId) {
        await pollConnectorNow(client, connectorId).catch(() => {});
      }
      const runs = await client.get(`/workflows/${workflowId}/runs`);
      const fresh = runs
        .filter((r) => new Date(r.createdAt).getTime() > sinceMs && !excludeIds.has(r.id))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      return fresh.length > 0 ? fresh[0] : null;
    },
    { label: 'a new run to appear after the email is detected', tries: 30, delayMs: 4000, ...opts },
  );
  return waitForRunStatus(client, run.id, ['COMPLETED', 'FAILED', 'WAITING'], { tries: 30, delayMs: 2000 });
}

export async function createWorkflow(client, body) {
  return client.post('/workflows', body);
}

export async function patchWorkflow(client, id, body) {
  return client.patch(`/workflows/${id}`, body);
}

export async function runWorkflow(client, id, trigger) {
  return client.post(`/workflows/${id}/run`, { trigger });
}

export async function getRun(client, runId) {
  return client.get(`/workflows/runs/${runId}`);
}

export async function waitForRunStatus(client, runId, statuses, opts = {}) {
  return poll(
    async () => {
      const run = await getRun(client, runId);
      return statuses.includes(run.status) ? run : null;
    },
    { label: `run ${runId} to reach [${statuses.join(',')}]`, ...opts },
  );
}

/**
 * Run a SQL statement directly against the Postgres container (docker exec).
 * ONLY for arranging test preconditions that have no public API (e.g. forcing
 * a connector to DEGRADED, or a subscription to PAST_DUE — both are normally
 * driven by real external events/webhooks). Never used to assert outcomes —
 * always verify results through the real API afterward.
 */
export async function dbExec(sql, container = process.env.PG_CONTAINER || 'vaep-postgres-1') {
  const { stdout: out } = await execFileP('docker', [
    'exec', container, 'psql', '-U', 'vaep', '-d', 'vaep', '-tA', '-c', sql,
  ]);
  return out.trim();
}
