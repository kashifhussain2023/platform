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
import type { TeamDto } from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { OrganizationService } from './organization.service';

/**
 * Teams (P1 #7), tenant-scoped by companyId from the JWT. Reading is open to any
 * authenticated member; mutations are @Roles('OWNER','ADMIN'). A team may
 * optionally belong to a department (validated to be in the same tenant).
 */
@Controller('teams')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TeamsController {
  constructor(private readonly org: OrganizationService) {}

  @Get()
  list(@CurrentTenant() companyId: string): Promise<TeamDto[]> {
    return this.org.listTeams(companyId);
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  create(
    @CurrentTenant() companyId: string,
    @Body() dto: CreateTeamDto,
  ): Promise<TeamDto> {
    return this.org.createTeam(companyId, dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  update(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
  ): Promise<TeamDto> {
    return this.org.updateTeam(companyId, id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(204)
  remove(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.org.removeTeam(companyId, id);
  }
}
