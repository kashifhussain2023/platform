import { Injectable } from '@nestjs/common';
import type { Company } from '@prisma/client';
import type { CompanyDto, UpdateCompanyDto } from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Prisma Company row → public CompanyDto (shared across tenant/auth/onboarding). */
export function toCompanyDto(company: Company): CompanyDto {
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    industry: company.industry,
    size: company.size,
    country: company.country,
    timezone: company.timezone,
    website: company.website,
    logoUrl: company.logoUrl,
    description: company.description,
    onboardedAt: company.onboardedAt ? company.onboardedAt.toISOString() : null,
    createdAt: company.createdAt.toISOString(),
  };
}

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the company scoped to the authenticated tenant. */
  async findById(companyId: string): Promise<CompanyDto> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
    });
    return toCompanyDto(company);
  }

  /** Updates the current tenant's company profile (partial). */
  async update(companyId: string, dto: UpdateCompanyDto): Promise<CompanyDto> {
    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        name: dto.name,
        industry: dto.industry,
        size: dto.size,
        country: dto.country,
        timezone: dto.timezone,
        website: dto.website,
        logoUrl: dto.logoUrl,
        description: dto.description,
      },
    });
    return toCompanyDto(company);
  }
}
