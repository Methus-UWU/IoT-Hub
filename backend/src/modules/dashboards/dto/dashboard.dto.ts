import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { DATASTREAM_DATA_TYPES, DATASTREAM_KEY } from '../datastream-rules';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SaveDashboardDto {
  /**
   * The dashboard document. Its shape is checked field by field by
   * `parseDashboardDocument`, which is the one validator for every way a document
   * arrives (this route, templates, the assistant).
   */
  @IsObject()
  document!: Record<string, unknown>;

  /** Omit only when creating. Present means "update, if still at this version". */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class DatastreamDto {
  @IsString()
  @Matches(DATASTREAM_KEY, {
    message:
      'key must start with a letter and use letters, digits, or _ (max 32)',
  })
  key!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsIn(DATASTREAM_DATA_TYPES)
  dataType!: 'number' | 'boolean' | 'string';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(16)
  unit?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  min?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  max?: number | null;

  /** Component property that produces the value, e.g. "temperature". */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]{0,64}$/)
  source?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  componentId?: string | null;
}

export class CreateTemplateDto {
  /** The project whose dashboard and datastreams become version 1. */
  @IsUUID()
  projectId!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(['private', 'workspace'])
  visibility?: 'private' | 'workspace';
}

export class TemplateVersionDto {
  @IsUUID()
  projectId!: string;
}

export class UpdateTemplateDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(['private', 'workspace'])
  visibility?: 'private' | 'workspace';
}

export class TemplateVersionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class ApplyTemplateDto {
  @IsUUID()
  templateId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  /** The dashboard version the client is replacing; omit when it has none yet. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
