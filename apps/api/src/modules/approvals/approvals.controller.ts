import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ApprovalRequestDto, ApprovalStatus } from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.provider';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ApprovalService } from './approval.service';
import { DecideApprovalDto } from './dto/decide-approval.dto';
import { ModifyApprovalDto } from './dto/modify-approval.dto';

/**
 * Approval Center routes: tenant-scoped by companyId (from the JWT), JWT-guarded.
 * Deciding requests (approve/reject/modify) is @Roles('OWNER','ADMIN'); reads
 * (list/get the queue) stay open to any authenticated member.
 */
@Controller('approvals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalService) {}

  /** List approval requests, optionally filtered by ?status=PENDING|APPROVED|REJECTED. */
  @Get()
  list(
    @CurrentTenant() companyId: string,
    @Query('status') status?: ApprovalStatus,
  ): Promise<ApprovalRequestDto[]> {
    return this.approvals.list(companyId, status);
  }

  @Get(':id')
  get(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<ApprovalRequestDto> {
    return this.approvals.get(companyId, id);
  }

  /** Approve → execute the stored tool call now. */
  @Post(':id/approve')
  @Roles('OWNER', 'ADMIN')
  approve(
    @CurrentTenant() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DecideApprovalDto,
  ): Promise<ApprovalRequestDto> {
    return this.approvals.approve(companyId, id, user.userId, dto.note);
  }

  /** Reject → mark REJECTED without executing. */
  @Post(':id/reject')
  @Roles('OWNER', 'ADMIN')
  reject(
    @CurrentTenant() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DecideApprovalDto,
  ): Promise<ApprovalRequestDto> {
    return this.approvals.reject(companyId, id, user.userId, dto.note);
  }

  /** Modify → execute with edited args, then mark APPROVED. */
  @Post(':id/modify')
  @Roles('OWNER', 'ADMIN')
  modify(
    @CurrentTenant() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ModifyApprovalDto,
  ): Promise<ApprovalRequestDto> {
    return this.approvals.modify(companyId, id, user.userId, dto.args, dto.note);
  }
}
