import type { User } from '@prisma/client';
import type { UserDto } from '@vaep/types';

/** Prisma User row → public UserDto. NEVER includes passwordHash. */
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    companyId: user.companyId,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}
