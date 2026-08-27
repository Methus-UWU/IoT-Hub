import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const DEVICE_PORT_PATTERN = /^[a-zA-Z0-9._:/-]+$/;

export class WorkspaceFilePathDto {
  @IsString()
  @MaxLength(240)
  path!: string;
}

export class SaveWorkspaceFileDto extends WorkspaceFilePathDto {
  @IsString()
  @MaxLength(524_288)
  content!: string;
}

export class BuildWorkspaceDto {
  @IsOptional()
  @IsIn(['build', 'upload'])
  target: 'build' | 'upload' = 'build';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(DEVICE_PORT_PATTERN)
  port?: string;
}

export class SerialMonitorDto {
  @IsString()
  @MaxLength(120)
  @Matches(DEVICE_PORT_PATTERN)
  port!: string;

  @Type(() => Number)
  @IsInt()
  @Min(300)
  @Max(4_000_000)
  baud = 115_200;
}

export class SerialOutputDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cursor = 0;
}
