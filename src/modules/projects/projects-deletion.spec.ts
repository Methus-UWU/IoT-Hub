import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from '../auth/supabase-auth.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { EntitlementService } from '../billing/entitlement.service';
import { UserRepository } from '../users/user.repository';
import { WorkspaceRepository } from '../workspaces/workspace.repository';
import { ProjectComponentsService } from './project-components.service';
import { ProjectConnectionsService } from './project-connections.service';
import { ProjectFilesService } from './project-files.service';
import {
  ProjectComponentRepository,
  ProjectRepository,
} from './project.repository';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

describe('Project deletion authorization', () => {
  const findMembership = jest.fn();
  const findById = jest.fn();
  const deleteProject = jest.fn();
  const request = { user: { id: 'user' } } as AuthenticatedRequest;
  let controller: ProjectsController;

  beforeEach(async () => {
    jest.resetAllMocks();
    findMembership.mockResolvedValue({ role: 'owner' });
    findById.mockResolvedValue({ id: 'project', workspaceId: 'workspace' });
    deleteProject.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        ProjectsService,
        AuthorizationService,
        {
          provide: ProjectRepository,
          useValue: { findById, delete: deleteProject },
        },
        { provide: WorkspaceRepository, useValue: { findMembership } },
        ...[
          UserRepository,
          EntitlementService,
          ProjectComponentRepository,
          ProjectComponentsService,
          ProjectConnectionsService,
          ProjectFilesService,
        ].map((provide) => ({ provide, useValue: {} })),
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(ProjectsController);
  });

  it.each(['owner', 'admin'])(
    'allows a workspace %s to delete its project',
    async (role) => {
      findMembership.mockResolvedValue({ role });
      await expect(
        controller.remove(request, 'workspace', 'project'),
      ).resolves.toEqual({ deleted: true });
      expect(findMembership).toHaveBeenCalledWith('workspace', 'user');
      expect(deleteProject).toHaveBeenCalledWith('project');
    },
  );

  it.each(['viewer', 'editor', 'developer'])(
    'refuses a workspace %s before looking up the project',
    async (role) => {
      findMembership.mockResolvedValue({ role });
      await expect(
        controller.remove(request, 'workspace', 'project'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(findById).not.toHaveBeenCalled();
      expect(deleteProject).not.toHaveBeenCalled();
    },
  );

  it('conceals workspaces from non-members', async () => {
    findMembership.mockResolvedValue(null);
    await expect(
      controller.remove(request, 'workspace', 'project'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it('refuses a project in another workspace even for an owner', async () => {
    findById.mockResolvedValue({
      id: 'project',
      workspaceId: 'another-workspace',
    });
    await expect(
      controller.remove(request, 'workspace', 'project'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it('does not report success for a missing project', async () => {
    findById.mockResolvedValue(null);
    await expect(
      controller.remove(request, 'workspace', 'project'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(deleteProject).not.toHaveBeenCalled();
  });
});
