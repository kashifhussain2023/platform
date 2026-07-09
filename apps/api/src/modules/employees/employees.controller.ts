import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  AiEmployeeDto,
  ConversationDto,
} from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';

/** All routes are tenant-scoped by companyId from the JWT and JWT-guarded. */
@Controller('employees')
@UseGuards(JwtAuthGuard)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Post()
  create(
    @CurrentTenant() companyId: string,
    @Body() dto: CreateEmployeeDto,
  ): Promise<AiEmployeeDto> {
    return this.employees.create(companyId, dto);
  }

  @Get()
  list(@CurrentTenant() companyId: string): Promise<AiEmployeeDto[]> {
    return this.employees.list(companyId);
  }

  @Get(':id')
  get(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<AiEmployeeDto> {
    return this.employees.get(companyId, id);
  }

  @Patch(':id')
  update(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<AiEmployeeDto> {
    return this.employees.update(companyId, id, dto);
  }

  @Delete(':id')
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
  ): Promise<ConversationDto[]> {
    return this.employees.listConversations(companyId, employeeId);
  }
}
