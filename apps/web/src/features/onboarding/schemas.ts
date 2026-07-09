// Re-export the shared validation contract so components import from the feature.
export { completeOnboardingSchema, DEPARTMENTS } from '@vaep/types';
export type {
  CompleteOnboardingDto,
  CompleteOnboardingResultDto,
  Department,
  EmployeeRoleTemplate,
  OnboardingStatusDto,
} from '@vaep/types';
