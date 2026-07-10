// Re-export the shared validation contract so components import from the feature.
export {
  createDepartmentSchema,
  updateDepartmentSchema,
  createTeamSchema,
  updateTeamSchema,
  updateSecurityPolicySchema,
} from '@vaep/types';
export type {
  DepartmentDto,
  CreateDepartmentDto,
  UpdateDepartmentDto,
  TeamDto,
  CreateTeamDto,
  UpdateTeamDto,
  SecurityPolicyDto,
  UpdateSecurityPolicyDto,
} from '@vaep/types';
