import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  ValidateNested,
} from 'class-validator';

import { AiChatMessageDto } from '../dto/ai-chat.dto';

export const ADVISOR_MODES = ['advice', 'error'] as const;
export type AdvisorMode = (typeof ADVISOR_MODES)[number];

/**
 * A conversation with the IoT advisor. There is deliberately no model override
 * and no system-context switch: those are administrator controls.
 */
export class IotAdvisorChatDto {
  @IsOptional()
  @IsIn(ADVISOR_MODES)
  mode?: AdvisorMode;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AiChatMessageDto)
  messages!: AiChatMessageDto[];
}
