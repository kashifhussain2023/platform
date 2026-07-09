import { IsIn } from 'class-validator';
import {
  PLANS,
  type ChangePlanDto as IChangePlanDto,
  type Plan,
} from '@vaep/types';

/** POST /billing/subscription body. Mirrors the shared @vaep/types contract. */
export class ChangePlanDto implements IChangePlanDto {
  @IsIn(PLANS)
  plan!: Plan;
}
