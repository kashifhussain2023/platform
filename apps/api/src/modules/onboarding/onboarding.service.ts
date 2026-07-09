import { Injectable } from '@nestjs/common';
import type {
  AiEmployeeDto,
  CompleteOnboardingResultDto,
  EmployeeRoleTemplate,
  OnboardingStatusDto,
} from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { toCompanyDto } from '../tenant/tenant.service';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { ONBOARDING_CATALOG } from './onboarding.catalog';

/**
 * Drives the AI Onboarding Wizard. The company remains the tenant; completing
 * the wizard captures the business profile, hires the selected AI employees
 * (reusing EmployeesService.create), and stamps company.onboardedAt.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
  ) {}

  /** Onboarding is "completed" once company.onboardedAt is set. */
  async status(companyId: string): Promise<OnboardingStatusDto> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { onboardedAt: true },
    });
    return { completed: Boolean(company.onboardedAt) };
  }

  /** The code-defined hire catalog (source of truth). */
  catalog(): EmployeeRoleTemplate[] {
    return ONBOARDING_CATALOG.map((t) => ({
      ...t,
      departments: [...t.departments],
    }));
  }

  /**
   * Complete onboarding: create the chosen AI employees, then persist the
   * business profile + onboardedAt. Employees are created first so that if any
   * create fails the company is NOT marked onboarded (stays resumable).
   */
  async complete(
    companyId: string,
    dto: CompleteOnboardingDto,
  ): Promise<CompleteOnboardingResultDto> {
    const created: AiEmployeeDto[] = [];
    for (const entry of dto.employees) {
      const suggested = ONBOARDING_CATALOG.find(
        (t) => t.role === entry.role,
      )?.suggestedName;
      const name = entry.name?.trim() || suggested || entry.role;
      created.push(await this.employees.create(companyId, { name, role: entry.role }));
    }

    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        industry: dto.business?.industry,
        size: dto.business?.size,
        description: dto.business?.description,
        onboardedAt: new Date(),
      },
    });

    return { company: toCompanyDto(company), employees: created };
  }
}
