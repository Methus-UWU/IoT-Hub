import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Catalog ids look like `vendor/model` or `vendor/model:free`. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/:-]{0,159}$/;
const MAX_CREDITS = 1_000_000;

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class CreditLimitsDto {
  /** -1 is unlimited. */
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  @Max(MAX_CREDITS)
  daily!: number;

  @Type(() => Number)
  @IsInt()
  @Min(-1)
  @Max(MAX_CREDITS)
  weekly!: number;

  @Type(() => Number)
  @IsInt()
  @Min(-1)
  @Max(MAX_CREDITS)
  monthly!: number;
}

export class CreditResetScheduleDto {
  @IsInt()
  @Min(0)
  @Max(1439)
  dailyMinute!: number;

  @IsInt()
  @Min(0)
  @Max(1439)
  weeklyMinute!: number;

  @IsInt()
  @Min(0)
  @Max(6)
  weeklyDay!: number;

  @IsInt()
  @Min(0)
  @Max(1439)
  monthlyMinute!: number;

  @IsInt()
  @Min(1)
  @Max(28)
  monthlyDay!: number;
}

export class UpdateAiSettingsDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => CreditResetScheduleDto)
  resets?: CreditResetScheduleDto;

  /** null returns model choice to the environment pins and the ranked catalog. */
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(MODEL_ID, { message: 'primaryModel is not a catalog model id' })
  primaryModel?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Matches(MODEL_ID, {
    each: true,
    message: 'fallbackModels has an invalid model id',
  })
  fallbackModels?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CreditLimitsDto)
  defaults?: CreditLimitsDto;
}

export class CreditOverrideDto {
  /** null keeps the default; -1 is unlimited. */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  @Max(MAX_CREDITS)
  daily?: number | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  @Max(MAX_CREDITS)
  weekly?: number | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  @Max(MAX_CREDITS)
  monthly?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
