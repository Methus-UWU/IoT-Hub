import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  Max,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Mirrors MAX_FILE_BYTES, so an oversized body is rejected before it is read. */
const MAX_CONTENT_LENGTH = 524_288;

export class ProjectFilePathDto {
  @IsString()
  @MaxLength(240)
  path!: string;
}

export class SaveProjectFileDto {
  @IsString()
  @MaxLength(240)
  path!: string;

  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  content!: string;

  /** Omit only when creating. Present means "update, if still at this version". */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class SaveProjectFilesDto {
  @IsArray()
  @ArrayMinSize(1)
  // Bounded so one autosave cannot become an unbounded transaction.
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SaveProjectFileDto)
  files!: SaveProjectFileDto[];
}

export class CreateProjectDto {
  /**
   * Catalog id of the board this project starts with, e.g. 'esp32-devkit-v1'.
   * Required: a project without a board would open to an empty canvas after the
   * user had already chosen one.
   */
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9][a-z0-9._-]*$/)
  boardId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9 ._-]*$/)
  board?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9 ._+-]*$/)
  framework?: string;
}

export class CreateComponentDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9][a-z0-9._-]*$/)
  definitionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  /** Omit both to let the server find a free spot instead of stacking. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-100000)
  @Max(100000)
  x?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-100000)
  @Max(100000)
  y?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(359)
  rotation?: number;

  @IsOptional()
  @IsObject()
  state?: Record<string, unknown>;
}

export class UpdateComponentDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-100000)
  @Max(100000)
  x?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-100000)
  @Max(100000)
  y?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(359)
  rotation?: number;

  @IsOptional()
  @IsObject()
  state?: Record<string, unknown>;
}
