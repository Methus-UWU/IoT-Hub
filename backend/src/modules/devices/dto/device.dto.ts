import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { TELEMETRY_RANGES, type TelemetryRange } from '../telemetry.service';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Same rule as a datastream key. */
export const DATASTREAM_KEY_PARAM = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

export class DeviceNameDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;
}

export class TelemetryReportDto {
  /** `{ "temperature": 24.5, "relay": true }`; each key must be a project datastream. */
  @IsObject()
  values!: Record<string, unknown>;
}

export class ControlValueDto {
  @IsDefined()
  value!: unknown;
}

export class SeriesQueryDto {
  @IsString()
  @Matches(DATASTREAM_KEY_PARAM, { message: 'key is not a datastream key' })
  key!: string;

  @IsIn(TELEMETRY_RANGES)
  range!: TelemetryRange;
}
