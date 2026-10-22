import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * What the conversation needs from a model, not which model to use.
 *
 * `Auto` lets the server infer the profile from the conversation itself; the
 * concrete profiles are for an administrator who wants to force the trade-off.
 */
export enum AiTaskProfile {
  Auto = 'auto',
  Fast = 'fast',
  Balanced = 'balanced',
  Deep = 'deep',
}

export class AiChatMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(12_000)
  content!: string;
}

export class AiChatDto {
  /** Legacy admin clients may send this; admin chat uses the shared IDE policy. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  model?: string;

  /** Accepted for older clients; ignored by admin chat. */
  @IsOptional()
  @IsEnum(AiTaskProfile)
  profile?: AiTaskProfile;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AiChatMessageDto)
  messages!: AiChatMessageDto[];

  @IsOptional()
  @IsBoolean()
  includeSystemContext = true;
}
