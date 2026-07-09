import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AiEmployeeDto,
  MarketplaceCatalogDto,
  WorkflowDto,
} from '@vaep/types';
import { EmployeesService } from '../employees/employees.service';
import { SkillsService } from '../skills/skills.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { InstallEmployeeDto } from './dto/install-employee.dto';
import { MarketplaceCatalog } from './marketplace.catalog';

/**
 * The unified marketplace (Step 14): a code-defined catalog of installable AI
 * Employees, Workflow Templates, and Skills. There is NO new persistence —
 * installs DELEGATE to the existing tenant-scoped services (Employees /
 * Workflows / Skills). Marketplace is a leaf module: it imports the others and
 * none import it, so there is no dependency cycle.
 */
@Injectable()
export class MarketplaceService {
  constructor(
    private readonly employees: EmployeesService,
    private readonly workflows: WorkflowsService,
    private readonly skills: SkillsService,
  ) {}

  /** The unified catalog: employees + workflows + (reused) skills. */
  catalog(): MarketplaceCatalogDto {
    return {
      employees: MarketplaceCatalog.employees(),
      workflows: MarketplaceCatalog.workflows(),
      // Reuse the existing Skills catalog verbatim (not duplicated).
      skills: this.skills.getCatalog(),
    };
  }

  /** Hire an employee from a template → EmployeesService.create. 404 if unknown. */
  async installEmployee(
    companyId: string,
    key: string,
    dto: InstallEmployeeDto,
  ): Promise<AiEmployeeDto> {
    const template = MarketplaceCatalog.getEmployee(key);
    if (!template) {
      throw new NotFoundException(`Unknown employee template: ${key}`);
    }
    return this.employees.create(companyId, {
      name: dto.name?.trim() || template.name,
      role: template.role,
      persona: template.persona,
    });
  }

  /** Install a workflow template → WorkflowsService.create. 404 if unknown. */
  async installWorkflow(companyId: string, key: string): Promise<WorkflowDto> {
    const template = MarketplaceCatalog.getWorkflow(key);
    if (!template) {
      throw new NotFoundException(`Unknown workflow template: ${key}`);
    }
    return this.workflows.create(companyId, {
      name: template.name,
      description: template.description,
      definition: template.definition,
    });
  }
}
