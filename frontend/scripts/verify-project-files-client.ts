import '@angular/compiler';
import assert from 'node:assert/strict';
import { HttpErrorResponse } from '@angular/common/http';
import { Injector } from '@angular/core';
import { Observable, defer, of, throwError } from 'rxjs';
import { ProjectsApiService } from '../src/app/core/services/projects-api.service';
import { WorkspaceContextService } from '../src/app/core/services/workspace-context.service';
import {
  ProjectFileConflictError,
  ProjectFilesClient,
} from '../src/app/features/user/workspace/project-files.client';

/**
 * The IDE's file client against a server that enforces versions the way the API
 * does. The race these checks pin down was seen in production: an autosave still in
 * flight and the save before an upload stated the same version, the second got 409,
 * and the IDE said "backend offline".
 */

let checks = 0;
async function check(name: string, test: () => Promise<void>): Promise<void> {
  await test();
  checks++;
  console.log(`PASS ${name}`);
}

class FakeServer {
  readonly files = new Map<string, { content: string; version: number }>();
  puts = 0;

  /** Answers after a tick, so two saves can be in flight at once. */
  save(path: string, content: string, expectedVersion?: number): Observable<{ version: number }> {
    return defer(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      this.puts++;
      const current = this.files.get(path);
      const conflict =
        expectedVersion === undefined
          ? current !== undefined
          : current?.version !== expectedVersion;
      if (conflict) {
        throw new HttpErrorResponse({
          status: 409,
          error: { error: { code: 'FILE_VERSION_CONFLICT' } },
        });
      }
      const version = (current?.version ?? 0) + 1;
      this.files.set(path, { content, version });
      return { version };
    });
  }

  read(path: string) {
    const file = this.files.get(path);
    return file
      ? of({
          path,
          content: file.content,
          version: file.version,
          sizeBytes: 0,
          contentHash: '',
          updatedAt: '',
        })
      : throwError(() => new HttpErrorResponse({ status: 404 }));
  }
}

function fixture() {
  const server = new FakeServer();
  server.files.set('src/main.cpp', { content: 'v1', version: 1 });
  const api = {
    readFile: (_w: string, _p: string, path: string) => server.read(path),
    saveFile: (
      _w: string,
      _p: string,
      body: { path: string; content: string; expectedVersion?: number },
    ) => server.save(body.path, body.content, body.expectedVersion),
  };
  const injector = Injector.create({
    providers: [
      { provide: ProjectFilesClient, useClass: ProjectFilesClient },
      { provide: ProjectsApiService, useValue: api },
      {
        provide: WorkspaceContextService,
        useValue: { ensureLoaded: () => of({ id: 'workspace' }) },
      },
    ],
  });
  return { server, client: injector.get(ProjectFilesClient) };
}

async function main(): Promise<void> {
  await check('two saves of one file at once both succeed, in order', async () => {
    const { server, client } = fixture();
    await client.read('project', 'src/main.cpp');

    await Promise.all([
      client.save('project', 'src/main.cpp', 'autosave text'),
      client.save('project', 'src/main.cpp', 'text before upload'),
    ]);

    assert.equal(server.files.get('src/main.cpp')?.content, 'text before upload');
  });

  await check('an unchanged file is not sent again', async () => {
    const { server, client } = fixture();
    await client.read('project', 'src/main.cpp');
    await client.save('project', 'src/main.cpp', 'edited');
    const puts = server.puts;

    await client.save('project', 'src/main.cpp', 'edited');

    assert.equal(server.puts, puts);
  });

  await check('a 409 for text the server already holds counts as saved', async () => {
    const { server, client } = fixture();
    await client.read('project', 'src/main.cpp');
    // Another writer stored the same text first; this client still holds version 1.
    server.files.set('src/main.cpp', { content: 'same text', version: 2 });

    await client.save('project', 'src/main.cpp', 'same text');
    await client.save('project', 'src/main.cpp', 'next edit');

    assert.equal(server.files.get('src/main.cpp')?.content, 'next edit');
  });

  await check('a real conflict is reported as one, not as a network failure', async () => {
    const { server, client } = fixture();
    await client.read('project', 'src/main.cpp');
    server.files.set('src/main.cpp', { content: 'written by the assistant', version: 2 });

    await assert.rejects(
      client.save('project', 'src/main.cpp', 'stale tab'),
      ProjectFileConflictError,
    );
    assert.equal(server.files.get('src/main.cpp')?.content, 'written by the assistant');
  });

  await check('forgetting the files a plan wrote leaves the other files saveable', async () => {
    const { server, client } = fixture();
    server.files.set('src/config.h', { content: 'c1', version: 1 });
    await client.read('project', 'src/main.cpp');
    await client.read('project', 'src/config.h');
    server.files.set('src/main.cpp', { content: 'written by the assistant', version: 2 });

    client.forget('project', ['src/main.cpp']);

    await client.save('project', 'src/config.h', 'edited by the user');
    assert.equal(server.files.get('src/config.h')?.content, 'edited by the user');
  });

  console.log(`${checks}/${checks} project file client checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
