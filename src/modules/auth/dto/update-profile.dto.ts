import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Email is deliberately absent: Supabase Auth owns the address, and changing it
 * there triggers its own verification flow. A database trigger mirrors the new
 * address onto the profile, so accepting an email here would let a caller
 * desynchronise the two.
 */
export class UpdateProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message:
      'Username may contain only letters, numbers, dots, underscores, and hyphens',
  })
  username!: string;
}
