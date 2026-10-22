import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ProjectsModule } from '../projects/projects.module';
import {
  LibraryRegistryController,
  ProjectLibrariesController,
} from './libraries.controller';
import { LibrariesService } from './libraries.service';
import { LibraryRegistry, PlatformioRegistryClient } from './library-registry';

@Module({
  imports: [AuthModule, AuthorizationModule, ProjectsModule],
  controllers: [LibraryRegistryController, ProjectLibrariesController],
  providers: [
    LibrariesService,
    { provide: LibraryRegistry, useClass: PlatformioRegistryClient },
  ],
})
export class LibrariesModule {}
