import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { AiChatMessageDto, AiTaskProfile } from '../../dto/ai-chat.dto';

/**
 * Mirrors MAX_FILE_BYTES so an oversized body is rejected before the plan is replayed.
 * The file service checks it again; this only saves reading a body that cannot be applied.
 */
const MAX_CONTENT_LENGTH = 524_288;

/**
 * One finding the browser's circuit checker reported.
 *
 * Everything here is text produced on the client, so it is capped and quoted rather than
 * believed: the server states its own wiring audit separately, from the stored circuit.
 */
export class DiagnosticFindingDto {
  @IsIn(['error', 'warning', 'info'])
  severity!: 'error' | 'warning' | 'info';

  @IsString()
  @MaxLength(80)
  code!: string;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(400)
  detail!: string;
}

/** A compile or runtime fault from the firmware simulator. */
export class FirmwareFaultDto {
  @IsIn(['compile', 'run'])
  phase!: 'compile' | 'run';

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  line!: number;

  @IsString()
  @MaxLength(400)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  file?: string;
}

/** What the IDE currently shows the user: faults, findings, serial and build output. */
export class ProjectDiagnosticsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DiagnosticFindingDto)
  wiring?: DiagnosticFindingDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => FirmwareFaultDto)
  firmware?: FirmwareFaultDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  serial?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  build?: string[];

  @IsOptional()
  @IsIn(['idle', 'building', 'success', 'error'])
  buildState?: 'idle' | 'building' | 'success' | 'error';
}

export class ProjectChatDto {
  /**
   * The stored conversation this turn belongs to. With it, the server reads the
   * history itself and keeps the question and the answer; only the last message of
   * `messages` is used.
   */
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  /** An AI profile for a turn outside a conversation. */
  @IsOptional()
  @IsUUID()
  profileId?: string;

  /** Explicit model from the live catalog. Omitted, the server ranks and chooses. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  model?: string;

  @IsOptional()
  @IsEnum(AiTaskProfile)
  profile?: AiTaskProfile;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AiChatMessageDto)
  messages!: AiChatMessageDto[];

  /**
   * File open in the editor. A hint only — it is checked against the project's own file
   * list, and a path that is not there is dropped rather than trusted.
   */
  @IsOptional()
  @IsString()
  @MaxLength(240)
  activeFile?: string;

  /**
   * What the IDE is showing: simulator faults and findings, serial and build output.
   *
   * The server cannot see any of it — the simulation runs in the browser — so this is the
   * only way the assistant learns why the user thinks something is broken. It is advisory
   * and quoted as the client's report; the wiring audit the server does itself is separate.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => ProjectDiagnosticsDto)
  diagnostics?: ProjectDiagnosticsDto;
}

export class PlanEndpointDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  componentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  pinId!: string;
}

/**
 * One action from a plan the server previously produced.
 *
 * The whole plan comes back from the client, so every field here is untrusted. Nothing is
 * applied on the strength of what it says: components are re-resolved, wires are
 * re-validated by the assignment engine, and files go through the same quota and path
 * checks as an editor save.
 */
export class PlanActionDto {
  @IsIn([
    'add_device',
    'configure',
    'connect',
    'disconnect',
    'write_file',
    'set_dashboard',
  ])
  type!:
    | 'add_device'
    | 'configure'
    | 'connect'
    | 'disconnect'
    | 'write_file'
    | 'set_dashboard';

  // add_device
  @IsOptional()
  @IsString()
  @MaxLength(80)
  ref?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  definitionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  // add_device and configure. Checked value by value against the catalog at apply.
  @IsOptional()
  @IsObject()
  settings?: Record<string, string | number | boolean>;

  // configure
  @IsOptional()
  @IsString()
  @MaxLength(80)
  componentId?: string;

  // connect
  @IsOptional()
  @ValidateNested()
  @Type(() => PlanEndpointDto)
  from?: PlanEndpointDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PlanEndpointDto)
  to?: PlanEndpointDto;

  @IsOptional()
  @IsIn(['power', 'ground', 'signal'])
  kind?: 'power' | 'ground' | 'signal';

  @IsOptional()
  @IsString()
  @MaxLength(16)
  color?: string;

  // disconnect
  @IsOptional()
  @IsString()
  @MaxLength(80)
  connectionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  summary?: string;

  // write_file
  @IsOptional()
  @IsString()
  @MaxLength(240)
  path?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  content?: string;

  @IsOptional()
  created?: boolean;

  // set_dashboard. The document is rebuilt by parseDashboardDocument at apply and the
  // datastreams are re-validated, so neither is trusted as sent.
  @IsOptional()
  @IsObject()
  document?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  datastreams?: unknown[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  baseVersion?: number;
}

export class ApplyPlanDto {
  @IsArray()
  @ArrayMinSize(1)
  // Bounded so one accepted proposal cannot become an unbounded batch of writes.
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => PlanActionDto)
  actions!: PlanActionDto[];
}
