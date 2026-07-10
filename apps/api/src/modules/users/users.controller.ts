import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { UserDto } from '@vaep/types';
import type { AuthenticatedUser } from '../auth/auth.provider';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

/**
 * Company-scoped user management (tenant-scoped by companyId from the JWT).
 * Reading the roster is open to any authenticated member; every MUTATION is
 * @Roles('OWNER','ADMIN') — an OWNER outranks ADMIN so owner tokens pass all.
 */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentTenant() companyId: string): Promise<UserDto[]> {
    return this.users.list(companyId);
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  create(
    @CurrentTenant() companyId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: CreateUserDto,
  ): Promise<UserDto> {
    return this.users.create(companyId, caller, dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  update(
    @CurrentTenant() companyId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserDto> {
    return this.users.update(companyId, caller, id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(204)
  remove(
    @CurrentTenant() companyId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.users.remove(companyId, caller, id);
  }
}
