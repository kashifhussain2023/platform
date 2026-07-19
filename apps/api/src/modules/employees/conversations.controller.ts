import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { MessageDto, RunResultDto } from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SendMessageDto } from './dto/send-message.dto';
import { EmployeesService } from './employees.service';

/** Conversation-scoped message routes (tenant-scoped, JWT-guarded). */
@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly employees: EmployeesService) {}

  @Get(':id/messages')
  listMessages(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ): Promise<MessageDto[]> {
    return this.employees.listMessages(companyId, id, limit);
  }

  /**
   * Send a user message → run one agent turn → return the RunResultDto (the
   * user + assistant messages are persisted). Rejects with 409 if the employee
   * is PAUSED/DISABLED.
   */
  @Post(':id/messages')
  sendMessage(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ): Promise<RunResultDto> {
    return this.employees.sendMessage(companyId, id, dto.content);
  }
}
