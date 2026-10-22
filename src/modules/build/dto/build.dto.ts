import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBase64,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { BUILD_FAILURE_REASONS } from '../build-job.repository';
import { ARTIFACT_NAMES } from '../build-plan';

/** An 8 MiB image is about 11.2 MiB of base64. */
const MAX_ARTIFACT_BASE64_LENGTH = 11_200_000;

export class WorkerArtifactDto {
  @IsIn(ARTIFACT_NAMES)
  name!: (typeof ARTIFACT_NAMES)[number];

  @IsString()
  @MaxLength(MAX_ARTIFACT_BASE64_LENGTH)
  @IsBase64()
  data!: string;
}

/**
 * A build result from the dispatcher.
 *
 * The dispatcher is trusted to be the dispatcher, but what it forwards was shaped
 * by user code inside the build container, so every field is bounded and the
 * service re-checks the artifact set against the platform.
 */
export class WorkerBuildResultDto {
  @IsIn(['succeeded', 'failed'])
  status!: 'succeeded' | 'failed';

  @IsOptional()
  @IsIn(BUILD_FAILURE_REASONS)
  failureReason?: (typeof BUILD_FAILURE_REASONS)[number];

  /** Trimmed to the kept tail by the service; this only bounds the request. */
  @IsString()
  @MaxLength(1_000_000)
  log!: string;

  @IsInt()
  @Min(0)
  @Max(3_600_000)
  durationMs!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ARTIFACT_NAMES.length)
  @ValidateNested({ each: true })
  @Type(() => WorkerArtifactDto)
  artifacts?: WorkerArtifactDto[];
}
