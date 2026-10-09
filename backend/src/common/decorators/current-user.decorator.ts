import { ExecutionContext, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { AdminRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  isAdmin: boolean;
  status: string;
  adminRole?: AdminRole;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
  if (!request.user) throw new UnauthorizedException('Not authenticated');
  return request.user;
});
