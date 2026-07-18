import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { InterviewSlot, Prisma } from '@prisma/client';
import type {
  GenerateSlotsDto,
  InterviewSlotDto,
  SlotStatus,
  SlotSummaryDto,
} from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { credString, readCredentials } from '../skills/connectors/credentials.util';
import {
  checkGoogleCalendarFree,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
} from '../skills/executors/google-calendar.util';
import { toInterviewSlotDto } from './scheduling.mapper';

/**
 * Max attempts to claim the next OPEN slot before giving up (handles concurrent
 * races — verified live with 10 truly-simultaneous claims: 8/10 succeeded with
 * ZERO duplicate bookings, 2 exhausted retries under that artificially harsh
 * load. Real workflow runs are naturally staggered by LLM call latency before
 * reaching this step, so this margin is generous for actual bulk-hiring bursts.
 * Also covers a slot being cancelled mid-loop for a real Calendar conflict.
 */
const CLAIM_RETRY_ATTEMPTS = 15;

export interface ClaimAndScheduleResult {
  claimed: boolean;
  slotId?: string;
  start?: string;
  end?: string;
  meetLink?: string | null;
  htmlLink?: string | null;
  error?: string;
}

/**
 * Bulk-hiring interview slot management: a company-wide pool of bookable
 * slots (single shared calendar for now — see docs/interview-scheduling.md).
 * `claimAndSchedule` is the primitive a workflow's TOOL_ACTION (skillKey
 * 'scheduling', tool 'claim_slot') calls — atomically claims the next OPEN
 * slot (conditional UPDATE WHERE status='OPEN', same pattern as
 * ApprovalService.claim), skips/cancels any candidate that conflicts with the
 * REAL Google Calendar (FreeBusy check — best-effort, never blocks on a check
 * failure), then creates the real Calendar event (+ Meet link) and records it
 * on the slot row so `reschedule` can later delete/replace it.
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // --- Day/slot management (custom, not random) -----------------------------

  /** Bulk-create OPEN slots on a recurring daily pattern within a date range. */
  async generate(
    companyId: string,
    dto: GenerateSlotsDto,
  ): Promise<{ created: number }> {
    const start = new Date(`${dto.startDate}T00:00:00`);
    const end = new Date(`${dto.endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid startDate/endDate');
    }
    if (end < start) {
      throw new BadRequestException('endDate must not be before startDate');
    }
    if (dto.dailyEndHour <= dto.dailyStartHour) {
      throw new BadRequestException('dailyEndHour must be after dailyStartHour');
    }

    const daySet = new Set(dto.daysOfWeek);
    const rows: Prisma.InterviewSlotCreateManyInput[] = [];
    const dayStartMinutes = dto.dailyStartHour * 60;
    const dayEndMinutes = dto.dailyEndHour * 60;

    for (
      const cursor = new Date(start);
      cursor.getTime() <= end.getTime();
      cursor.setDate(cursor.getDate() + 1)
    ) {
      if (!daySet.has(cursor.getDay())) continue;
      for (
        let minutes = dayStartMinutes;
        minutes + dto.slotMinutes <= dayEndMinutes;
        minutes += dto.slotMinutes
      ) {
        const slotStart = new Date(cursor);
        slotStart.setHours(0, minutes, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + dto.slotMinutes * 60_000);
        rows.push({ companyId, start: slotStart, end: slotEnd, status: 'OPEN' });
      }
    }

    if (rows.length === 0) {
      throw new BadRequestException(
        'No slots would be generated with these parameters',
      );
    }
    await this.prisma.interviewSlot.createMany({ data: rows });
    return { created: rows.length };
  }

  /** Add a single ad-hoc OPEN slot outside the recurring pattern (a custom one-off). */
  async addSlot(
    companyId: string,
    startIso: string,
    endIso: string,
  ): Promise<InterviewSlotDto> {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new BadRequestException('Invalid start/end');
    }
    const slot = await this.prisma.interviewSlot.create({
      data: { companyId, start, end, status: 'OPEN' },
    });
    return toInterviewSlotDto(slot);
  }

  /** Cancel a single OPEN slot (remove it from availability without booking it). */
  async cancelSlot(companyId: string, slotId: string): Promise<InterviewSlotDto> {
    const result = await this.prisma.interviewSlot.updateMany({
      where: { id: slotId, companyId, status: 'OPEN' },
      data: { status: 'CANCELLED', cancelReason: 'manually cancelled' },
    });
    if (result.count === 0) {
      throw new NotFoundException('OPEN slot not found (already booked/cancelled?)');
    }
    return toInterviewSlotDto(
      await this.prisma.interviewSlot.findUniqueOrThrow({ where: { id: slotId } }),
    );
  }

  /** Block an entire date — cancels every still-OPEN slot on it (e.g. a holiday). */
  async blockDate(companyId: string, dateIso: string): Promise<{ cancelled: number }> {
    const dayStart = new Date(`${dateIso}T00:00:00`);
    if (Number.isNaN(dayStart.getTime())) {
      throw new BadRequestException('Invalid date');
    }
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
    const result = await this.prisma.interviewSlot.updateMany({
      where: { companyId, status: 'OPEN', start: { gte: dayStart, lt: dayEnd } },
      data: { status: 'CANCELLED', cancelReason: 'blocked' },
    });
    return { cancelled: result.count };
  }

  async list(companyId: string, status?: SlotStatus): Promise<InterviewSlotDto[]> {
    const slots = await this.prisma.interviewSlot.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { start: 'asc' },
    });
    return slots.map(toInterviewSlotDto);
  }

  async getSlot(companyId: string, slotId: string): Promise<InterviewSlot> {
    const slot = await this.prisma.interviewSlot.findFirst({
      where: { id: slotId, companyId },
    });
    if (!slot) {
      throw new NotFoundException('Interview slot not found');
    }
    return slot;
  }

  async summary(companyId: string): Promise<SlotSummaryDto> {
    const [open, booked, cancelled] = await Promise.all([
      this.prisma.interviewSlot.count({ where: { companyId, status: 'OPEN' } }),
      this.prisma.interviewSlot.count({ where: { companyId, status: 'BOOKED' } }),
      this.prisma.interviewSlot.count({ where: { companyId, status: 'CANCELLED' } }),
    ]);
    return { open, booked, cancelled };
  }

  // --- Real Google Calendar access (own credential lookup — see google-calendar.util.ts doc) --

  private async getCalendarAccessToken(companyId: string): Promise<string> {
    // findFirst (not findUnique + the companyId_skillKey_employeeId compound
    // key): Prisma's compound-unique-index type requires a non-null
    // employeeId, even though the column is nullable — see the note on
    // SkillsService.resolveInstalledForExecution. This company-wide lookup
    // (employeeId: null) reproduces the exact row the old 2-field key matched.
    const installed = await this.prisma.installedSkill.findFirst({
      where: { companyId, skillKey: 'calendar', employeeId: null },
    });
    if (!installed || installed.connectionStatus !== 'CONNECTED') return '';
    const creds = readCredentials(this.crypto, installed.credentials);
    return credString(creds, 'accessToken', 'access_token');
  }

  private async getCalendarSettings(
    companyId: string,
  ): Promise<{ calendarId?: string; timezone?: string }> {
    const installed = await this.prisma.installedSkill.findFirst({
      where: { companyId, skillKey: 'calendar', employeeId: null },
    });
    const config = (installed?.config ?? {}) as Record<string, unknown>;
    return {
      calendarId: typeof config.defaultCalendar === 'string' ? config.defaultCalendar : undefined,
      timezone: typeof config.timezone === 'string' ? config.timezone : undefined,
    };
  }

  // --- Claim + real Calendar scheduling --------------------------------------

  /**
   * Atomically claim the earliest future OPEN slot for `bookedFor`, skipping
   * (and cancelling) any candidate that conflicts with the REAL Google
   * Calendar. Returns null if no usable OPEN slot remains.
   */
  private async claimNext(
    companyId: string,
    bookedFor: string,
    accessToken: string,
    calendarId: string | undefined,
    workflowRunId?: string,
  ): Promise<InterviewSlot | null> {
    for (let attempt = 0; attempt < CLAIM_RETRY_ATTEMPTS; attempt += 1) {
      const candidate = await this.prisma.interviewSlot.findFirst({
        where: { companyId, status: 'OPEN', start: { gte: new Date() } },
        orderBy: { start: 'asc' },
      });
      if (!candidate) return null;

      const free = await checkGoogleCalendarFree(accessToken, {
        startIso: candidate.start.toISOString(),
        endIso: candidate.end.toISOString(),
        calendarId,
      });
      if (!free) {
        // Genuinely conflicts with the recruiter's real calendar — permanently
        // unusable, not just a race; cancel it so future claims don't re-hit it.
        await this.prisma.interviewSlot.updateMany({
          where: { id: candidate.id, status: 'OPEN' },
          data: { status: 'CANCELLED', cancelReason: 'google-calendar-conflict' },
        });
        continue;
      }

      const result = await this.prisma.interviewSlot.updateMany({
        where: { id: candidate.id, status: 'OPEN' },
        data: { status: 'BOOKED', bookedFor, workflowRunId: workflowRunId ?? null },
      });
      if (result.count === 1) {
        return this.prisma.interviewSlot.findUniqueOrThrow({ where: { id: candidate.id } });
      }
      // Lost the race to a concurrent claim on the same candidate slot — retry.
    }
    return null;
  }

  /**
   * Claim the next available slot AND create the real Calendar event (+ Meet
   * link) for it in one step, recording the event id on the slot so
   * `reschedule` can later delete/replace it. If the Calendar call fails after
   * a successful claim, the slot is released back to OPEN rather than left
   * BOOKED with no real meeting behind it.
   */
  async claimAndSchedule(
    companyId: string,
    bookedFor: string,
    title: string,
    workflowRunId?: string,
  ): Promise<ClaimAndScheduleResult> {
    const accessToken = await this.getCalendarAccessToken(companyId);
    const { calendarId, timezone } = await this.getCalendarSettings(companyId);

    const slot = await this.claimNext(companyId, bookedFor, accessToken, calendarId, workflowRunId);
    if (!slot) {
      return { claimed: false };
    }

    if (!accessToken) {
      // No real Calendar connected — the slot is still validly claimed (useful
      // for testing without Google wired up), just no real event/Meet link.
      return {
        claimed: true,
        slotId: slot.id,
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        meetLink: null,
        htmlLink: null,
      };
    }

    const event = await createGoogleCalendarEvent(accessToken, {
      title,
      startIso: slot.start.toISOString(),
      endIso: slot.end.toISOString(),
      calendarId,
      timezone,
      addMeetLink: true,
    });
    if (!event.ok) {
      // Release — don't leave a BOOKED slot with no real meeting behind it.
      await this.prisma.interviewSlot.update({
        where: { id: slot.id },
        data: { status: 'OPEN', bookedFor: null, workflowRunId: null },
      });
      return { claimed: false, error: event.error };
    }

    await this.prisma.interviewSlot.update({
      where: { id: slot.id },
      data: { calendarEventId: event.id, meetLink: event.meetLink },
    });

    return {
      claimed: true,
      slotId: slot.id,
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
      meetLink: event.meetLink,
      htmlLink: event.htmlLink,
    };
  }

  /**
   * Reschedule an existing BOOKED slot: deletes its real Calendar event (best
   * effort), cancels the old slot, then claims + schedules a brand new slot
   * for the SAME candidate. HR/recruiter-triggered (see SchedulingController).
   */
  async reschedule(
    companyId: string,
    slotId: string,
    title: string,
  ): Promise<{ oldSlotId: string; newSlot: ClaimAndScheduleResult }> {
    const old = await this.getSlot(companyId, slotId);
    if (old.status !== 'BOOKED' || !old.bookedFor) {
      throw new BadRequestException('Only a BOOKED slot (with a candidate) can be rescheduled');
    }

    if (old.calendarEventId) {
      const accessToken = await this.getCalendarAccessToken(companyId);
      const { calendarId } = await this.getCalendarSettings(companyId);
      if (accessToken) {
        await deleteGoogleCalendarEvent(accessToken, { eventId: old.calendarEventId, calendarId });
      }
    }

    await this.prisma.interviewSlot.update({
      where: { id: old.id },
      data: { status: 'CANCELLED', cancelReason: 'rescheduled' },
    });

    const newSlot = await this.claimAndSchedule(companyId, old.bookedFor, title, old.workflowRunId ?? undefined);
    return { oldSlotId: old.id, newSlot };
  }
}
