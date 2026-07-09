import { IsObject } from 'class-validator';
import type { ConfigureSkillDto as IConfigureSkillDto } from '@vaep/types';

/**
 * PATCH /skills/installed/:id/config body. The raw shape is a free-form object;
 * each field is validated against the skill's catalog `configSchema` in the
 * service (type / required / select-options). Mirrors @vaep/types.
 */
export class ConfigureSkillDto implements IConfigureSkillDto {
  @IsObject()
  config!: Record<string, unknown>;
}
