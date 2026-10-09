import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '@prisma/client';
import { ADMIN_ROLES_KEY } from '../decorators/admin-roles.decorator';
import type { AuthUser } from '../decorators/current-user.decorator';

/**
 * Admin RBAC. Admors authenticate with the same JWT but must carry
 * `isAdmin`, and - when a route lists roles - one of those roles.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user || !user.isAdmin) throw new ForbiddenException('Admin access required');

    const required = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required && required.length > 0) {
      const role = user.adminRole;
      if (!role || !required.includes(role as AdminRole)) {
        throw new ForbiddenException('Insufficient admin permissions');
      }
    }
    return true;
  }
}
