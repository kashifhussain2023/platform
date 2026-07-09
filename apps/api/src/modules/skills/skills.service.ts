import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type InstalledSkill } from '@prisma/client';
import type {
  EmployeeSkillDto,
  InstalledSkillDto,
  SkillDefinitionDto,
  ToolCallDto,
  ToolDefinitionDto,
} from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SkillCatalog } from './catalog';
import { InstallSkillDto } from './dto/install-skill.dto';
import { UpdateInstalledSkillDto } from './dto/update-installed-skill.dto';
import {
  SKILL_EXECUTOR_TOKEN,
  type ExecutorContext,
  type SkillExecutionResult,
  type SkillExecutor,
} from './executors/skill-executor';
import { toEmployeeSkillDto, toInstalledSkillDto } from './skills.mapper';

/**
 * Tenant-scoped skills: install/uninstall built-in skills, assign them to
 * employees, resolve an employee's available tools, and run a tool through the
 * (swappable) SkillExecutor while writing an audit row. Every query is scoped by
 * companyId (from the JWT) so tenants never see each other's skills.
 */
@Injectable()
export class SkillsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SKILL_EXECUTOR_TOKEN) private readonly executor: SkillExecutor,
  ) {}

  // --- Catalog -------------------------------------------------------------

  /** The built-in catalog (code, not DB) with each skill's tools. */
  getCatalog(): SkillDefinitionDto[] {
    return SkillCatalog.list();
  }

  // --- Installed skills ----------------------------------------------------

  async install(
    companyId: string,
    dto: InstallSkillDto,
  ): Promise<InstalledSkillDto> {
    const def = SkillCatalog.get(dto.skillKey);
    if (!def) {
      throw new NotFoundException(`Unknown skill: ${dto.skillKey}`);
    }
    const existing = await this.prisma.installedSkill.findUnique({
      where: { companyId_skillKey: { companyId, skillKey: dto.skillKey } },
    });
    if (existing) {
      throw new ConflictException('Skill is already installed');
    }
    const row = await this.prisma.installedSkill.create({
      data: {
        companyId,
        skillKey: dto.skillKey,
        displayName: dto.displayName?.trim() || def.name,
        config:
          dto.config === undefined
            ? undefined
            : (dto.config as Prisma.InputJsonObject),
        enabled: true,
      },
    });
    return toInstalledSkillDto(row);
  }

  async listInstalled(companyId: string): Promise<InstalledSkillDto[]> {
    const rows = await this.prisma.installedSkill.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toInstalledSkillDto);
  }

  async updateInstalled(
    companyId: string,
    id: string,
    dto: UpdateInstalledSkillDto,
  ): Promise<InstalledSkillDto> {
    await this.findOwnedInstalled(companyId, id);
    const row = await this.prisma.installedSkill.update({
      where: { id },
      data: {
        enabled: dto.enabled,
        displayName: dto.displayName,
        config:
          dto.config === undefined
            ? undefined
            : (dto.config as Prisma.InputJsonObject),
      },
    });
    return toInstalledSkillDto(row);
  }

  async uninstall(companyId: string, id: string): Promise<void> {
    await this.findOwnedInstalled(companyId, id);
    // Cascades to EmployeeSkill assignments (onDelete: Cascade).
    await this.prisma.installedSkill.delete({ where: { id } });
  }

  // --- Assignments (employee ↔ installed skill) ----------------------------

  async assign(
    companyId: string,
    employeeId: string,
    installedSkillId: string,
  ): Promise<EmployeeSkillDto> {
    await this.assertEmployee(companyId, employeeId);
    await this.findOwnedInstalled(companyId, installedSkillId);
    // Idempotent: re-assigning an already-assigned skill returns the existing row.
    const existing = await this.prisma.employeeSkill.findUnique({
      where: { employeeId_installedSkillId: { employeeId, installedSkillId } },
    });
    if (existing) {
      return toEmployeeSkillDto(existing);
    }
    const row = await this.prisma.employeeSkill.create({
      data: { companyId, employeeId, installedSkillId },
    });
    return toEmployeeSkillDto(row);
  }

  async unassign(
    companyId: string,
    employeeId: string,
    installedSkillId: string,
  ): Promise<void> {
    await this.assertEmployee(companyId, employeeId);
    const row = await this.prisma.employeeSkill.findFirst({
      where: { companyId, employeeId, installedSkillId },
    });
    if (!row) {
      throw new NotFoundException('Skill is not assigned to this employee');
    }
    await this.prisma.employeeSkill.delete({ where: { id: row.id } });
  }

  async listEmployeeSkills(
    companyId: string,
    employeeId: string,
  ): Promise<EmployeeSkillDto[]> {
    await this.assertEmployee(companyId, employeeId);
    const rows = await this.prisma.employeeSkill.findMany({
      where: { companyId, employeeId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toEmployeeSkillDto);
  }

  // --- Runtime seam --------------------------------------------------------

  /** Tools available to an employee: from its assigned + ENABLED installed skills. */
  async getToolsForEmployee(
    companyId: string,
    employeeId: string,
  ): Promise<ToolDefinitionDto[]> {
    const rows = await this.prisma.employeeSkill.findMany({
      where: { companyId, employeeId, installedSkill: { enabled: true } },
      include: { installedSkill: true },
      orderBy: { createdAt: 'asc' },
    });
    const tools: ToolDefinitionDto[] = [];
    for (const row of rows) {
      const def = SkillCatalog.get(row.installedSkill.skillKey);
      if (def) {
        tools.push(...def.tools);
      }
    }
    return tools;
  }

  /**
   * Execute a tool via the SkillExecutor and WRITE a SkillExecution audit row.
   * Never throws for tool-level failures — returns a ToolCallDto with ok:false
   * so the caller (runtime or manual endpoint) can surface it.
   */
  async runTool(
    ctx: ExecutorContext,
    skillKey: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallDto> {
    const safeArgs = (args ?? {}) as Record<string, unknown>;

    let outcome: SkillExecutionResult;
    if (!SkillCatalog.getTool(skillKey, tool)) {
      outcome = { ok: false, error: `Unknown skill/tool: ${skillKey}/${tool}` };
    } else {
      try {
        outcome = await this.executor.execute(skillKey, tool, safeArgs, ctx);
      } catch (err) {
        outcome = {
          ok: false,
          error: err instanceof Error ? err.message : 'Tool execution failed',
        };
      }
    }

    await this.prisma.skillExecution.create({
      data: {
        companyId: ctx.companyId,
        employeeId: ctx.employeeId ?? null,
        conversationId: ctx.conversationId ?? null,
        skillKey,
        tool,
        args: safeArgs as Prisma.InputJsonObject,
        result:
          outcome.result == null
            ? Prisma.JsonNull
            : (outcome.result as Prisma.InputJsonValue),
        status: outcome.ok ? 'SUCCESS' : 'ERROR',
        error: outcome.error ?? null,
      },
    });

    return {
      skillKey,
      tool,
      args: safeArgs,
      result: outcome.result ?? null,
      ok: outcome.ok,
    };
  }

  /** Manual execution of a tool on an installed skill (logs a SkillExecution). */
  async executeInstalledTool(
    companyId: string,
    installedSkillId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallDto> {
    const installed = await this.findOwnedInstalled(companyId, installedSkillId);
    if (!installed.enabled) {
      throw new ConflictException('Skill is disabled');
    }
    if (!SkillCatalog.getTool(installed.skillKey, tool)) {
      throw new NotFoundException(`Unknown tool: ${tool}`);
    }
    return this.runTool({ companyId }, installed.skillKey, tool, args);
  }

  // --- Ownership helpers ---------------------------------------------------

  private async findOwnedInstalled(
    companyId: string,
    id: string,
  ): Promise<InstalledSkill> {
    const row = await this.prisma.installedSkill.findFirst({
      where: { id, companyId },
    });
    if (!row) {
      throw new NotFoundException('Installed skill not found');
    }
    return row;
  }

  private async assertEmployee(
    companyId: string,
    employeeId: string,
  ): Promise<void> {
    const employee = await this.prisma.aiEmployee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
  }
}
