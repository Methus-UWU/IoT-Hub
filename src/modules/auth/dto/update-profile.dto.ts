import { IsEmail, IsString, Matches } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @Matches(/^\S+$/, { message: 'Username cannot contain spaces' })
  username!: string;

  @IsEmail()
  email!: string;
}
