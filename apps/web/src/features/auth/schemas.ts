// Re-export the shared validation contract so components import from the feature.
export { loginSchema, registerSchema } from '@vaep/types';
export type { LoginDto, RegisterDto } from '@vaep/types';
