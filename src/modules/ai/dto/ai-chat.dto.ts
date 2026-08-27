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

export enum AiProviderId {
  OpenAi = 'openai',
  Anthropic = 'anthropic',
  Gemini = 'gemini',
  Gemma = 'gemma',
  DeepSeek = 'deepseek',
  Meta = 'meta',
  Nvidia = 'nvidia',
}

export class AiChatMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(12_000)
  content!: string;
}

export class AiChatDto {
  @IsEnum(AiProviderId)
  provider!: AiProviderId;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

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
