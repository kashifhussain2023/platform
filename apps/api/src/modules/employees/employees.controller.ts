import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  AiEmployeeDto,
  ConversationDto,
} from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';

/**
 * All routes are tenant-scoped by companyId from the JWT and JWT-guarded.
 * Managing employees (create/update/delete) is @Roles('OWNER','ADMIN'); reads
 * and starting/continuing conversations (chat) stay open to any member.
 */
@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Post()
  @Roles('OWNER', 'ADMIN')
  create(
    @CurrentTenant() companyId: string,
    @Body() dto: CreateEmployeeDto,
  ): Promise<AiEmployeeDto> {
    return this.employees.create(companyId, dto);
  }

  @Get()
  list(
    @CurrentTenant() companyId: string,
    @Query('limit') limit?: string,
  ): Promise<AiEmployeeDto[]> {
    return this.employees.list(companyId, limit);
  }

  @Get(':id')
  get(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<AiEmployeeDto> {
    return this.employees.get(companyId, id);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  update(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<AiEmployeeDto> {
    return this.employees.update(companyId, id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(204)
  remove(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.employees.remove(companyId, id);
  }

  @Post(':id/conversations')
  startConversation(
    @CurrentTenant() companyId: string,
    @Param('id') employeeId: string,
    @Body('title') title?: string,
  ): Promise<ConversationDto> {
    return this.employees.startConversation(companyId, employeeId, title);
  }

  @Get(':id/conversations')
  listConversations(
    @CurrentTenant() companyId: string,
    @Param('id') employeeId: string,
    @Query('limit') limit?: string,
  ): Promise<ConversationDto[]> {
    return this.employees.listConversations(companyId, employeeId, limit);
  }
}
