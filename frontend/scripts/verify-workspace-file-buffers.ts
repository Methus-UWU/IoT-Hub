import '@angular/compiler';
import assert from 'node:assert/strict';
import { Injector } from '@angular/core';
import { WorkspaceFileBuffers } from '../src/app/features/user/workspace/workspace-file-buffers.store';

/**
 * The IDE's buffers outlive the page. These checks pin what that must not cost: text
 * crossing projects, an unsaved edit dropped on a project switch, and a stale read
 * marker that would keep an assistant's write from ever reaching the editor.
 */

let checks = 0;
function check(name: string, test: () => void): void {
  test();
  checks++;
  console.log(`PASS ${name}`);
}

function buffers(): WorkspaceFileBuffers {
  return Injector.create({
    providers: [{ provide: WorkspaceFileBuffers, useClass: WorkspaceFileBuffers }],
  }).get(WorkspaceFileBuffers);
}

check('buffers are kept per project', () => {
  const store = buffers();
  store.set('a', 'main.ino', { content: 'A', savedContent: 'A' });
  store.set('b', 'main.ino', { content: 'B', savedContent: 'B' });
  assert.equal(store.filesOf('a')['main.ino']?.content, 'A');
  assert.equal(store.filesOf('b')['main.ino']?.content, 'B');
  assert.deepEqual(store.filesOf(null), {});
});

check('switching project drops clean buffers and keeps unsaved ones', () => {
  const store = buffers();
  store.set('a', 'clean.ino', { content: 'x', savedContent: 'x' });
  store.set('a', 'dirty.ino', { content: 'typed', savedContent: 'x' });
  store.markListed('a');
  store.hydrated.add('a:clean.ino');

  store.retainProject('b');

  assert.equal(store.filesOf('a')['clean.ino'], undefined);
  assert.equal(store.filesOf('a')['dirty.ino']?.content, 'typed');
  assert.equal(store.hydrated.has('a:clean.ino'), false);
  assert.equal(store.isListed('a'), true);
});

check('a project with nothing unsaved is forgotten entirely on switch', () => {
  const store = buffers();
  store.set('a', 'main.ino', { content: 'x', savedContent: 'x' });
  store.markListed('a');
  store.retainProject('b');
  assert.deepEqual(store.filesOf('a'), {});
  assert.equal(store.isListed('a'), false);
});

check('marking files stale keeps their text but forces a re-read', () => {
  const store = buffers();
  store.set('a', 'main.ino', { content: 'old', savedContent: 'old' });
  store.hydrated.add('a:main.ino');
  store.hydrations.set('a:main.ino', Promise.resolve());

  store.markStale('a', ['main.ino']);

  assert.equal(store.filesOf('a')['main.ino']?.content, 'old');
  assert.equal(store.hydrated.has('a:main.ino'), false);
  assert.equal(store.hydrations.has('a:main.ino'), false);
});

check('patch leaves a missing buffer missing', () => {
  const store = buffers();
  store.patch('a', 'gone.ino', (state) => ({ ...state, content: 'x' }));
  assert.equal(store.filesOf('a')['gone.ino'], undefined);
});

check('reset clears every account-scoped buffer', () => {
  const store = buffers();
  store.set('a', 'main.ino', { content: 'secret', savedContent: '' });
  store.markListed('a');
  store.hydrated.add('a:main.ino');
  store.reset();
  assert.deepEqual(store.filesOf('a'), {});
  assert.equal(store.isListed('a'), false);
  assert.equal(store.hydrated.size, 0);
});

console.log(`${checks}/${checks} workspace file buffer checks passed`);
