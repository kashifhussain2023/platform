import { Injectable } from '@nestjs/common';
import { SkillCatalog } from '../catalog';
import type {
  ExecutorContext,
  SkillExecutor,
  SkillExecutionResult,
} from './skill-executor';

/**
 * `SKILL_EXECUTOR=auto` dispatcher: per call, route to the REAL executor when the
 * tenant's installed skill is actually usable — i.e. it needs no connection
 * (catalog connection.type === 'none', e.g. the HTTP skill) OR it is CONNECTED
 * with credentials present. Otherwise fall back to the offline MOCK so an
 * unconnected skill still returns a (sandbox) result and never 500s.
 *
 * Relies on SkillsService having resolved connectionStatus + credentials into
 * `ctx` (this executor sets `usesInstalledCredentials`).
 */
@Injectable()
export class AutoSkillExecutor implements SkillExecutor {
  readonly name = 'auto';
  readonly usesInstalledCredentials = true;

  constructor(
    private readonly real: SkillExecutor,
    private readonly mock: SkillExecutor,
  ) {}

  execute(
    skillKey: string,
    tool: string,
    args: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<SkillExecutionResult> {
    const connectionType = SkillCatalog.get(skillKey)?.connection.type;
    const credsPresent = Boolean(
      ctx.credentials && Object.keys(ctx.credentials).length > 0,
    );
    const connected = ctx.connectionStatus === 'CONNECTED';
    const eligible =
      connectionType === 'none' || (connected && credsPresent);
    return eligible
      ? this.real.execute(skillKey, tool, args, ctx)
      : this.mock.execute(skillKey, tool, args, ctx);
  }
}
