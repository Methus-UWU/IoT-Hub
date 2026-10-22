import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  AI_PROFILE_TIERS,
  type AiProfileTier,
} from '../ai-conversation.repository';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** An empty model field means "let the server choose". */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/** Catalog ids look like `vendor/model` or `vendor/model:free`. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/:-]{0,159}$/;

export class CreateAiProfileDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(MODEL_ID, { message: 'model is not a catalog model id' })
  model?: string | null;

  @IsOptional()
  @IsIn(AI_PROFILE_TIERS)
  tier?: AiProfileTier;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string;

  /** `system` profiles are offered to everyone; only admins may create them. */
  @IsOptional()
  @IsIn(['personal', 'system'])
  scope?: 'personal' | 'system';
}

export class UpdateAiProfileDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(MODEL_ID, { message: 'model is not a catalog model id' })
  model?: string | null;

  @IsOptional()
  @IsIn(AI_PROFILE_TIERS)
  tier?: AiProfileTier;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string;
}

export class CreateConversationDto {
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  profileId?: string | null;
}

export class UpdateConversationDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  title?: string;

  /** `null` returns the conversation to the default profile. */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  profileId?: string | null;
}

export class PlanStateDto {
  @IsIn(['applied', 'failed', 'dismissed'])
  planState!: 'applied' | 'failed' | 'dismissed';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  planError?: string;
}

export class ImportedMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MinLength(1)
  @MaxLength(12_000)
  content!: string;
}

/**
 * A conversation kept in the browser before conversations moved to the server. It is
 * the user's own text, stored as-is; nothing in it is applied to the project.
 */
export class ImportConversationDto {
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  title!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ImportedMessageDto)
  messages!: ImportedMessageDto[];
}
