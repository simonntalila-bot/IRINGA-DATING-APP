import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EncryptionService } from '../common/crypto/encryption.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { OtpService } from './otp.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokensService, OtpService, JwtStrategy, JwtAuthGuard, AdminGuard, EncryptionService],
  exports: [AuthService, TokensService, OtpService, JwtAuthGuard, AdminGuard],
})
export class AuthModule {}
