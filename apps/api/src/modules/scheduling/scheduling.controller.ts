import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import type {
  InterviewSlotDto,
  RescheduleResultDto,
  SlotStatus,
  SlotSummaryDto,
} from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { AddSlotDto } from './dto/add-slot.dto';
import { BlockDateDto } from './dto/block-date.dto';
import { GenerateSlotsDto } from './dto/generate-slots.dto';
import { RescheduleSlotDto } from './dto/reschedule-slot.dto';
import { SchedulingService } from './scheduling.service';

/**
 * Interview slot management: tenant-scoped by companyId (from the JWT),
 * JWT-guarded. Writes (generate/add/cancel/block/reschedule) are
 * @Roles('OWNER','ADMIN'); reads (list/summary) stay open to any
 * authenticated member. Claiming a slot for a NEW candidate is NOT exposed
 * here — that only happens via a workflow's TOOL_ACTION (skillKey
 * 'scheduling', tool 'claim_slot'). Reschedule IS exposed here — it's an
 * HR-triggered action (e.g. a future "Reschedule" button), not a workflow step.
 */
@Controller('scheduling')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Post('slots/generate')
  @Roles('OWNER', 'ADMIN')
  generate(
    @CurrentTenant() companyId: string,
    @Body() dto: GenerateSlotsDto,
  ): Promise<{ created: number }> {
    return this.scheduling.generate(companyId, dto);
  }

  /** Add a single ad-hoc OPEN slot outside the recurring pattern (a custom one-off). */
  @Post('slots')
  @Roles('OWNER', 'ADMIN')
  addSlot(
    @CurrentTenant() companyId: string,
    @Body() dto: AddSlotDto,
  ): Promise<InterviewSlotDto> {
    return this.scheduling.addSlot(companyId, dto.start, dto.end);
  }

  /** Block an entire date — cancels every still-OPEN slot on it (e.g. a holiday). */
  @Post('slots/block-date')
  @Roles('OWNER', 'ADMIN')
  blockDate(
    @CurrentTenant() companyId: string,
    @Body() dto: BlockDateDto,
  ): Promise<{ cancelled: number }> {
    return this.scheduling.blockDate(companyId, dto.date);
  }

  /** Cancel a single OPEN slot (remove it from availability without booking it). */
  @Post('slots/:id/cancel')
  @Roles('OWNER', 'ADMIN')
  cancelSlot(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<InterviewSlotDto> {
    return this.scheduling.cancelSlot(companyId, id);
  }

  /**
   * Reschedule an already-BOOKED interview: deletes the old real Calendar
   * event, cancels the old slot, claims + schedules a new one for the same
   * candidate. HR/recruiter-triggered.
   */
  @Post('slots/:id/reschedule')
  @Roles('OWNER', 'ADMIN')
  reschedule(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Body() dto: RescheduleSlotDto,
  ): Promise<RescheduleResultDto> {
    return this.scheduling.reschedule(companyId, id, dto.title ?? 'Interview (rescheduled)');
  }

  @Get('slots')
  list(
    @CurrentTenant() companyId: string,
    @Query('status') status?: SlotStatus,
  ): Promise<InterviewSlotDto[]> {
    return this.scheduling.list(companyId, status);
  }

  @Get('slots/summary')
  summary(@CurrentTenant() companyId: string): Promise<SlotSummaryDto> {
    return this.scheduling.summary(companyId);
  }
}
