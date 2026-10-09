import { SetMetadata, applyDecorators } from '@nestjs/common';
import { AdminRole } from '@prisma/client';

export const ADMIN_ROLES_KEY = 'adminRoles';

/** Restrict an admin route to specific admin roles (RBAC). */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

export const SUPER_ADMIN_ONLY = applyDecorators(AdminRoles(AdminRole.SUPER_ADMIN));
