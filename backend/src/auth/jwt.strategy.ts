import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfig } from '../common/config/app-config';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AccessTokenPayload } from './tokens.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
    });
  }

  async validate(payload: AccessTokenPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        status: true,
        isAdmin: true,
        deletedAt: true,
        adminProfile: { select: { role: true, isActive: true } },
      },
    });

    if (!user || user.deletedAt || user.status === 'BANNED' || user.status === 'DELETED') {
      throw new UnauthorizedException('Account is not active');
    }

    return {
      id: user.id,
      isAdmin: user.isAdmin,
      status: user.status,
      adminRole: user.adminProfile?.isActive ? user.adminProfile.role : undefined,
    };
  }
}
