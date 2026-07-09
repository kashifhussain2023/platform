// Re-export the shared validation contract so components import from the feature.
export {
  installSkillSchema,
  updateInstalledSkillSchema,
  assignSkillSchema,
  executeToolSchema,
} from '@vaep/types';
export type {
  SkillCategory,
  SkillDefinitionDto,
  ToolDefinitionDto,
  ToolParametersDto,
  InstalledSkillDto,
  EmployeeSkillDto,
  ToolCallDto,
  SkillExecutionDto,
  SkillExecutionStatus,
  InstallSkillDto,
  UpdateInstalledSkillDto,
  AssignSkillDto,
  ExecuteToolDto,
} from '@vaep/types';
