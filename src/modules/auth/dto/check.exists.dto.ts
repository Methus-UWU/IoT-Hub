import { IsIn, IsString, MinLength } from 'class-validator';

export class CheckExistDto {
  @IsIn(['username', 'email'])
  field!: 'username' | 'email';

  @IsString()
  @MinLength(1)
  value!: string;
}
