import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class SignUpDto {
  @IsString()
  @Matches(/^\S+$/)
  username!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
