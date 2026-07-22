/**
 * Shared, plain-function Google Calendar API helpers — used by BOTH
 * RealSkillExecutor (calendar.create_event) and SchedulingService (interview
 * slot claim/reschedule needs its own conflict-check + event create/delete,
 * without SchedulingModule and SkillsModule importing each other, which would
 * close a DI cycle — see modules/skills/connectors/credentials.util.ts for the
 * same rationale). No injected services here, just an access token in.
 */
import { asFetchResponse } from '../../../common/http/fetch-response';

/** fetch() with an abort timeout so a hung backend can't stall the runtime. */
async function fetchWithTimeout(
  url: string,
  init: Parameters<typeof fetch>[1],
  timeoutMs = 10_000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return asFetchResponse(await fetch(url, { ...init, signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

export interface CreateEventInput {
  title: string;
  startIso: string;
  endIso: string;
  calendarId?: string;
  timezone?: string;
  addMeetLink?: boolean;
}

export type CreateEventResult =
  | { ok: true; id: string; htmlLink: string | null; meetLink: string | null }
  | { ok: false; error: string };

/** Create a real Google Calendar event, optionally with an auto-generated Meet link. */
export async function createGoogleCalendarEvent(
  accessToken: string,
  input: CreateEventInput,
): Promise<CreateEventResult> {
  const calendarId = input.calendarId || 'primary';
  const params = new URLSearchParams();
  if (input.addMeetLink) params.set('conferenceDataVersion', '1');
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${params.toString() ? `?${params.toString()}` : ''}`;

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      summary: input.title,
      start: { dateTime: input.startIso, ...(input.timezone ? { timeZone: input.timezone } : {}) },
      end: { dateTime: input.endIso, ...(input.timezone ? { timeZone: input.timezone } : {}) },
      ...(input.addMeetLink
        ? {
            conferenceData: {
              createRequest: {
                requestId: `vaep-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            },
          }
        : {}),
    }),
  });
  const data = (await res.json()) as {
    id?: string;
    htmlLink?: string;
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
    error?: { message?: string };
  };
  if (!res.ok || !data.id) {
    return { ok: false, error: `Calendar API error (${res.status}): ${data.error?.message ?? 'create_event failed'}` };
  }
  const meetLink =
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ?? null;
  return { ok: true, id: data.id, htmlLink: data.htmlLink ?? null, meetLink };
}

/**
 * Best-effort real-calendar conflict check via the FreeBusy API. Returns TRUE
 * (assume free) on any error/missing token — this is a courtesy pre-check, not
 * the source of truth; it must never block a claim just because the check
 * itself failed.
 */
export async function checkGoogleCalendarFree(
  accessToken: string,
  input: { startIso: string; endIso: string; calendarId?: string },
): Promise<boolean> {
  if (!accessToken) return true;
  try {
    const calendarId = input.calendarId || 'primary';
    const res = await fetchWithTimeout('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        timeMin: input.startIso,
        timeMax: input.endIso,
        items: [{ id: calendarId }],
      }),
    });
    if (!res.ok) return true;
    const data = (await res.json()) as {
      calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
    };
    // Google's response keys `calendars` by the RESOLVED calendar id (the
    // real email address), not the literal request-time id — requesting
    // "primary" but indexing the response by "primary" always misses,
    // making every slot look falsely free. There's only one requested item,
    // so just read whichever key came back.
    const calendars = data.calendars ?? {};
    const firstKey = Object.keys(calendars)[0];
    const busy = (firstKey ? calendars[firstKey]?.busy : undefined) ?? [];
    return busy.length === 0;
  } catch {
    return true;
  }
}

/** Best-effort delete — true if deleted or already gone; false only logs a caller-side warning. */
export async function deleteGoogleCalendarEvent(
  accessToken: string,
  input: { eventId: string; calendarId?: string },
): Promise<boolean> {
  if (!accessToken) return false;
  try {
    const calendarId = input.calendarId || 'primary';
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } },
    );
    // 410/404 → already gone, treat as success.
    return res.ok || res.status === 410 || res.status === 404;
  } catch {
    return false;
  }
}
