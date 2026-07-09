import { IsObject } from 'class-validator';
import type { ConnectSkillDto as IConnectSkillDto } from '@vaep/types';

/**
 * POST /skills/installed/:id/connect body. `credentials` carries the API key(s)
 * for `api_key` skills or a token for `oauth` skills (stubbed). Stored in the
 * InstalledSkill.credentials column and NEVER returned raw. Mirrors @vaep/types.
 */
export class ConnectSkillDto implements IConnectSkillDto {
  @IsObject()
  credentials!: Record<string, unknown>;
}
