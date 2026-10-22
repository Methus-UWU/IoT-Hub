import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { LIBRARY_SORTS, type LibrarySort } from '../library-registry';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Registry owners are account names. */
const OWNER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** Registry names allow spaces and punctuation, never a slash or a control character. */
const NAME = /^[^/\\\p{Cc}]{1,100}$/u;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/;

/** Platforms the builder image holds (`build-worker/builder/targets.json`). */
export const LIBRARY_PLATFORMS = ['espressif32', 'atmelavr'] as const;

export class SearchLibrariesQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  page?: number;

  @IsOptional()
  @IsIn(LIBRARY_PLATFORMS)
  platform?: (typeof LIBRARY_PLATFORMS)[number];

  @IsOptional()
  @IsIn(LIBRARY_SORTS)
  sort?: LibrarySort;
}

export class LibraryRefQueryDto {
  @IsString()
  @Matches(OWNER, { message: 'owner is not a registry account name' })
  owner!: string;

  @Transform(trim)
  @IsString()
  @Matches(NAME, { message: 'name is not a registry library name' })
  name!: string;
}

export class InstallLibraryDto extends LibraryRefQueryDto {
  @IsOptional()
  @IsString()
  @Matches(VERSION, { message: 'version is not a library version' })
  version?: string;
}
