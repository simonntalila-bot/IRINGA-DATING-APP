import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { AdminAuthService } from './admin-auth.service';

class AdminLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}

/**
 * Admin login. Kept separate from user login so staff credentials can be
 * rotated and audited independently of the dating surface.
 */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: AdminLoginDto) {
    return this.adminAuth.login(dto.email, dto.password);
  }
}

class PromoteAdminDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(72)
  password!: string;

  @IsIn(['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'SUPPORT'])
  role!: 'SUPER_ADMIN' | 'ADMIN' | 'MODERATOR' | 'SUPPORT';

  @IsOptional()
  @IsUUID()
  userId?: string;
}

export { PromoteAdminDto };
