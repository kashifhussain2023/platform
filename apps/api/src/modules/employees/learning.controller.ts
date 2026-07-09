import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  EmployeeFeedbackDto,
  EmployeeMemoryDto,
  LearningSummaryDto,
} from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { CreateMemoryDto } from './dto/create-memory.dto';
import { LearningService } from './learning.service';

/**
 * Continuous Learning routes (Step 15). Mounted under /employees alongside the
 * EmployeesController (Nest merges controllers sharing a base path). All routes
 * are tenant-scoped by companyId (from the JWT) and JWT-guarded.
 */
@Controller('employees')
@UseGuards(JwtAuthGuard)
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  // --- Feedback ------------------------------------------------------------

  @Post(':id/feedback')
  submitFeedback(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Body() dto: CreateFeedbackDto,
  ): Promise<EmployeeFeedbackDto> {
    return this.learning.submitFeedback(companyId, id, dto);
  }

  @Get(':id/feedback')
  listFeedback(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<EmployeeFeedbackDto[]> {
    return this.learning.listFeedback(companyId, id);
  }

  // --- Memory curation -----------------------------------------------------

  @Get(':id/memories')
  listMemories(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<EmployeeMemoryDto[]> {
    return this.learning.listMemories(companyId, id);
  }

  @Post(':id/memories')
  teachMemory(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Body() dto: CreateMemoryDto,
  ): Promise<EmployeeMemoryDto> {
    return this.learning.teachMemory(companyId, id, dto);
  }

  @Delete(':id/memories/:memoryId')
  @HttpCode(204)
  forgetMemory(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Param('memoryId') memoryId: string,
  ): Promise<void> {
    return this.learning.forgetMemory(companyId, id, memoryId);
  }

  // --- Learning summary ----------------------------------------------------

  @Get(':id/learning')
  summary(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<LearningSummaryDto> {
    return this.learning.summary(companyId, id);
  }
}
