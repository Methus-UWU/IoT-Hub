import { IsString, MaxLength } from 'class-validator';

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

// Build, serial-monitor, and device-port DTOs were removed together with the
// in-process PlatformIO execution they validated. They return in Phase 4 as the
// request contract of the isolated build worker.
