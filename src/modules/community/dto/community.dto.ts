import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * The lengths here mirror the CHECK constraints in the community migration, so an
 * oversized body is rejected before it reaches the database rather than coming
 * back as a constraint violation.
 */
export const POST_TITLE_MIN = 10;
export const POST_TITLE_MAX = 160;
export const POST_BODY_MIN = 20;
export const POST_BODY_MAX = 20_000;
export const COMMENT_BODY_MIN = 2;
export const COMMENT_BODY_MAX = 20_000;
export const POST_TAGS_MAX = 5;

export const POST_KINDS = ['question', 'discussion', 'showcase'] as const;
export const POST_SORTS = ['new', 'top', 'active'] as const;

const TAG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateCommunityPostDto {
  @IsOptional()
  @IsIn(POST_KINDS)
  kind?: (typeof POST_KINDS)[number];

  @Transform(trimmed)
  @IsString()
  @MinLength(POST_TITLE_MIN)
  @MaxLength(POST_TITLE_MAX)
  title!: string;

  @Transform(trimmed)
  @IsString()
  @MinLength(POST_BODY_MIN)
  @MaxLength(POST_BODY_MAX)
  body!: string;

  /** Slugs from the curated catalog. Unknown slugs are rejected by the service. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POST_TAGS_MAX)
  @ArrayUnique()
  @Matches(TAG_SLUG_PATTERN, { each: true })
  tags!: string[];
}

export class UpdateCommunityPostDto {
  @IsOptional()
  @IsIn(POST_KINDS)
  kind?: (typeof POST_KINDS)[number];

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(POST_TITLE_MIN)
  @MaxLength(POST_TITLE_MAX)
  title?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(POST_BODY_MIN)
  @MaxLength(POST_BODY_MAX)
  body?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POST_TAGS_MAX)
  @ArrayUnique()
  @Matches(TAG_SLUG_PATTERN, { each: true })
  tags?: string[];
}

export class ListCommunityPostsDto {
  @IsOptional()
  @IsIn(POST_SORTS)
  sort?: (typeof POST_SORTS)[number];

  @IsOptional()
  @Matches(TAG_SLUG_PATTERN)
  tag?: string;

  @IsOptional()
  @IsUUID()
  authorId?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  q?: string;

  /** Opaque; produced by a previous page of this same endpoint. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class CreateCommunityCommentDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(COMMENT_BODY_MIN)
  @MaxLength(COMMENT_BODY_MAX)
  body!: string;

  /** Present for a reply. Replies to a reply are refused: nesting stops at one. */
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateCommunityCommentDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(COMMENT_BODY_MIN)
  @MaxLength(COMMENT_BODY_MAX)
  body!: string;
}

export class CommunityVoteDto {
  /** 0 withdraws the vote. Anything else is stored as -1 or 1. */
  @Type(() => Number)
  @IsInt()
  @IsIn([-1, 0, 1])
  value!: -1 | 0 | 1;
}
