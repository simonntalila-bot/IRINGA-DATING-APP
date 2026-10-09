import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { Gender, RelationshipGoal } from '@prisma/client';

const E164 = /^\+?[0-9]{9,15}$/;

export class RegisterDto {
  @IsString()
  @Matches(E164, { message: 'phone must be a valid international phone number' })
  phone!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsString()
  @Length(2, 60)
  displayName!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be YYYY-MM-DD' })
  dateOfBirth!: string;

  @IsIn(Object.values(Gender))
  gender!: Gender;

  @IsIn(Object.values(RelationshipGoal))
  relationshipGoal!: RelationshipGoal;

  @IsOptional()
  @IsString()
  @Matches(E164)
  email?: string;

  // Explicit 18+ confirmation. Users under 18 are rejected server side too.
  @IsBoolean()
  confirm18Plus!: boolean;
}

export class LoginDto {
  @IsString()
  @Matches(E164, { message: 'phone must be a valid international phone number' })
  phone!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}

export class RequestOtpDto {
  @IsString()
  @Matches(E164)
  target!: string;

  @IsIn(['PHONE_VERIFICATION', 'PASSWORD_RESET'])
  purpose!: 'PHONE_VERIFICATION' | 'PASSWORD_RESET';

  @IsOptional()
  @IsIn(['phone', 'email'])
  channel?: 'phone' | 'email';
}

export class VerifyOtpDto {
  @IsString()
  @MaxLength(255)
  target!: string;

  @IsString()
  @Length(4, 8)
  code!: string;

  @IsIn(['PHONE_VERIFICATION', 'PASSWORD_RESET'])
  purpose!: 'PHONE_VERIFICATION' | 'PASSWORD_RESET';
}

export class RefreshDto {
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}

export class LogoutDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;

  @IsOptional()
  @IsBoolean()
  allDevices?: boolean;
}

export class ResetPasswordDto {
  @IsString()
  @Matches(E164)
  phone!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}
