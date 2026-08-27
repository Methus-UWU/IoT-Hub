import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @Matches(/^\S+$/, { message: 'Username cannot contain spaces' })
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @Matches(/[A-Z]/, {
    message: 'New password must contain an uppercase letter',
  })
  @Matches(/[!@#$%^&*(),.?":{}|<>]/, {
    message: 'New password must contain a special character',
  })
  password?: string;

  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';
}
