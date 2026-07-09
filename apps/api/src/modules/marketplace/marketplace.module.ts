import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { SkillsModule } from '../skills/skills.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';

/**
 * Marketplace expansion (Step 14): a unified, code-defined catalog to install
 * more AI Employees, Workflow Templates, and Skills. A LEAF module — it imports
 * the Employees / Workflows / Skills modules (reusing their exported services'
 * singletons) and none of them import it, so there is no dependency cycle. No
 * new Prisma models: installs delegate to the existing services.
 */
@Module({
  imports: [EmployeesModule, WorkflowsModule, SkillsModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
})
export class MarketplaceModule {}
