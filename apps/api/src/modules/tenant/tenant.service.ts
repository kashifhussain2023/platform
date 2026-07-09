import { Injectable } from '@nestjs/common';
import type { CompanyDto } from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the company scoped to the authenticated tenant. */
  async findById(companyId: string): Promise<CompanyDto> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
    });
    return {
      id: company.id,
      name: company.name,
      slug: company.slug,
      createdAt: company.createdAt.toISOString(),
    };
  }
}
