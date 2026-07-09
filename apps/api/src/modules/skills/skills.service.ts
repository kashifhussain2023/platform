import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type InstalledSkill } from '@prisma/client';
import type {
  ConfigFieldDto,
  EmployeeSkillDto,
  InstalledSkillDto,
  SkillDefinitionDto,
  ToolCallDto,
  ToolDefinitionDto,
} from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SkillCatalog, type SkillDefinition } from './catalog';
import { ConfigureSkillDto } from './dto/configure-skill.dto';
import { ConnectSkillDto } from './dto/connect-skill.dto';
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
        // Mirror the catalog connection type; starts NOT_CONNECTED (default).
        connectionType: def.connection.type,
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

  // --- Configuration + connection ------------------------------------------

  /**
   * Set company-specific configuration. Each provided field is validated against
   * the skill's catalog `configSchema` (type / required / select-options).
   * Non-secret fields are stored in `config`; `secret:true` fields go to
   * `credentials` (masked in responses). Config/connection is OPTIONAL and
   * NON-BLOCKING — the mock executor runs without either.
   */
  async configureSkill(
    companyId: string,
    id: string,
    dto: ConfigureSkillDto,
  ): Promise<InstalledSkillDto> {
    const installed = await this.findOwnedInstalled(companyId, id);
    const def = this.defFor(installed.skillKey);
    const { config, secrets } = this.partitionConfig(def, dto.config);

    const mergedConfig = {
      ...((installed.config as Record<string, unknown> | null) ?? {}),
      ...config,
    };
    const mergedCreds = {
      ...((installed.credentials as Record<string, unknown> | null) ?? {}),
      ...secrets,
    };

    const row = await this.prisma.installedSkill.update({
      where: { id },
      data: {
        config: mergedConfig as Prisma.InputJsonObject,
        credentials:
          Object.keys(mergedCreds).length > 0
            ? (mergedCreds as Prisma.InputJsonObject)
            : undefined,
      },
    });
    return toInstalledSkillDto(row);
  }

  /**
   * Connect an installed skill. For `api_key` skills the provided key(s) are
   * stored in `credentials`; for `oauth` skills this is a STUB that just marks
   * the skill connected (accepting whatever token is passed). Sets
   * connectionStatus=CONNECTED and connectionType from the catalog.
   *
   * TODO: real OAuth authorization-code flow; encrypt credentials at rest.
   */
  async connectSkill(
    companyId: string,
    id: string,
    dto: ConnectSkillDto,
  ): Promise<InstalledSkillDto> {
    const installed = await this.findOwnedInstalled(companyId, id);
    const def = this.defFor(installed.skillKey);

    const mergedCreds = {
      ...((installed.credentials as Record<string, unknown> | null) ?? {}),
      ...dto.credentials,
    };

    const row = await this.prisma.installedSkill.update({
      where: { id },
      data: {
        credentials: mergedCreds as Prisma.InputJsonObject,
        connectionType: def.connection.type,
        connectionStatus: 'CONNECTED',
      },
    });
    return toInstalledSkillDto(row);
  }

  /** Disconnect: clear credentials and reset connectionStatus. */
  async disconnectSkill(
    companyId: string,
    id: string,
  ): Promise<InstalledSkillDto> {
    await this.findOwnedInstalled(companyId, id);
    const row = await this.prisma.installedSkill.update({
      where: { id },
      data: {
        credentials: Prisma.JsonNull,
        connectionStatus: 'NOT_CONNECTED',
      },
    });
    return toInstalledSkillDto(row);
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

  // --- Config validation helpers -------------------------------------------

  /** Resolve the catalog definition for an installed skill (must exist). */
  private defFor(skillKey: string): SkillDefinition {
    const def = SkillCatalog.get(skillKey);
    if (!def) {
      throw new NotFoundException(`Unknown skill: ${skillKey}`);
    }
    return def;
  }

  /**
   * Validate each provided field against the skill's configSchema and split them
   * into non-secret `config` values and `secrets`. Unknown/invalid fields → 400.
   */
  private partitionConfig(
    def: SkillDefinition,
    input: Record<string, unknown>,
  ): { config: Record<string, unknown>; secrets: Record<string, unknown> } {
    const byKey = new Map<string, ConfigFieldDto>(
      (def.configSchema ?? []).map((f) => [f.key, f]),
    );
    const config: Record<string, unknown> = {};
    const secrets: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      const field = byKey.get(key);
      if (!field) {
        throw new BadRequestException(`Unknown config field: ${key}`);
      }
      this.assertFieldValue(field, value);
      if (field.secret) {
        secrets[key] = value;
      } else {
        config[key] = value;
      }
    }
    return { config, secrets };
  }

  /** Assert a single value matches its field's type / required / options. */
  private assertFieldValue(field: ConfigFieldDto, value: unknown): void {
    const empty = value === undefined || value === null || value === '';
    if (empty) {
      if (field.required) {
        throw new BadRequestException(`${field.key} is required`);
      }
      return; // clearing an optional field is allowed
    }
    switch (field.type) {
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new BadRequestException(`${field.key} must be a number`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new BadRequestException(`${field.key} must be a boolean`);
        }
        break;
      case 'select':
        if (
          typeof value !== 'string' ||
          !(field.options ?? []).includes(value)
        ) {
          throw new BadRequestException(
            `${field.key} must be one of: ${(field.options ?? []).join(', ')}`,
          );
        }
        break;
      case 'string':
      case 'textarea':
      default:
        if (typeof value !== 'string') {
          throw new BadRequestException(`${field.key} must be a string`);
        }
    }
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
