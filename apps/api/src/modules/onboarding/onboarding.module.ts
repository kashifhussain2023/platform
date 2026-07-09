import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/**
 * Onboarding module. Imports EmployeesModule so the wizard can hire AI
 * employees by reusing EmployeesService.create (single source of truth for
 * employee creation). PrismaService is global.
 */
@Module({
  imports: [EmployeesModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
