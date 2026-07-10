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
import type { DepartmentDto } from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { OrganizationService } from './organization.service';

/**
 * Departments (P1 #7), tenant-scoped by companyId from the JWT. Reading is open
 * to any authenticated member; mutations are @Roles('OWNER','ADMIN').
 */
@Controller('departments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DepartmentsController {
  constructor(private readonly org: OrganizationService) {}

  @Get()
  list(@CurrentTenant() companyId: string): Promise<DepartmentDto[]> {
    return this.org.listDepartments(companyId);
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  create(
    @CurrentTenant() companyId: string,
    @Body() dto: CreateDepartmentDto,
  ): Promise<DepartmentDto> {
    return this.org.createDepartment(companyId, dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  update(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
  ): Promise<DepartmentDto> {
    return this.org.updateDepartment(companyId, id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(204)
  remove(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.org.removeDepartment(companyId, id);
  }
}
