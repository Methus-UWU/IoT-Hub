import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

import { SEARCH_SCOPES, type SearchScope } from '../search-history.repository';

export class SearchScopeQueryDto {
  @IsIn(SEARCH_SCOPES)
  scope!: SearchScope;
}

export class RecordSearchDto {
  @IsIn(SEARCH_SCOPES)
  scope!: SearchScope;

  /** Whitespace is collapsed so "dht  22" and "dht 22" are one entry. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  query!: string;
}
