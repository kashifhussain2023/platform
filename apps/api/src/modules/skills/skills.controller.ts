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
  InstalledSkillDto,
  SkillDefinitionDto,
  ToolCallDto,
} from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InstallSkillDto } from './dto/install-skill.dto';
import { UpdateInstalledSkillDto } from './dto/update-installed-skill.dto';
import { ExecuteToolDto } from './dto/execute-tool.dto';
import { SkillsService } from './skills.service';

/** All routes are tenant-scoped by companyId from the JWT and JWT-guarded. */
@Controller('skills')
@UseGuards(JwtAuthGuard)
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  /** The built-in catalog + each skill's tools (code-defined, not per-tenant). */
  @Get('catalog')
  catalog(): SkillDefinitionDto[] {
    return this.skills.getCatalog();
  }

  @Post('install')
  install(
    @CurrentTenant() companyId: string,
    @Body() dto: InstallSkillDto,
  ): Promise<InstalledSkillDto> {
    return this.skills.install(companyId, dto);
  }

  @Get('installed')
  listInstalled(
    @CurrentTenant() companyId: string,
  ): Promise<InstalledSkillDto[]> {
    return this.skills.listInstalled(companyId);
  }

  @Patch('installed/:id')
  updateInstalled(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInstalledSkillDto,
  ): Promise<InstalledSkillDto> {
    return this.skills.updateInstalled(companyId, id, dto);
  }

  @Delete('installed/:id')
  @HttpCode(204)
  uninstall(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.skills.uninstall(companyId, id);
  }

  /** Manually run a tool on an installed skill (logs a SkillExecution). */
  @Post('installed/:id/tools/:tool/execute')
  execute(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Param('tool') tool: string,
    @Body() dto: ExecuteToolDto,
  ): Promise<ToolCallDto> {
    return this.skills.executeInstalledTool(companyId, id, tool, dto.args);
  }
}
