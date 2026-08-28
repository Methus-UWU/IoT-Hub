import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Password is deliberately absent. Supabase Auth owns credentials, so an
 * administrator resets a password through Supabase's own recovery flow rather than
 * by setting one here — which also means this API can never be used to take over an
 * account by silently overwriting its password.
 *
 * Email is absent for the same reason: it is changed through Supabase and mirrored
 * onto the profile by a database trigger.
 */
export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message:
      'Username may contain only letters, numbers, dots, underscores, and hyphens',
  })
  username?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';
}
