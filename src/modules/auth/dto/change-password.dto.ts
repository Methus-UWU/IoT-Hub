import { IsString, Matches, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @Matches(/[A-Z]/, {
    message: 'New password must contain an uppercase letter',
  })
  @Matches(/[!@#$%^&*(),.?":{}|<>]/, {
    message: 'New password must contain a special character',
  })
  newPassword!: string;
}
