import { IsString, MinLength } from 'class-validator';
import type { AssignSkillDto as IAssignSkillDto } from '@vaep/types';

/** POST /employees/:id/skills body. Mirrors the shared @vaep/types contract. */
export class AssignSkillDto implements IAssignSkillDto {
  @IsString()
  @MinLength(1)
  installedSkillId!: string;
}
