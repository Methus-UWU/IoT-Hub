import { gzipSync } from 'node:zlib';

import {
  LibraryArchiveError,
  extractLibrary,
  readTar,
  sanitizeLibraryJson,
} from './library-archive';
import { libraryDependencies, libraryFolderName } from './library-manifest';
import { tarOf } from './library-test-archive';

describe('library archives', () => {
  it('keeps sources, the manifest, and the license; drops examples, docs, and dotfiles', async () => {
    const archive = gzipSync(
      tarOf([
        {
          path: 'library.properties',
          content: 'name=DHT sensor library\nversion=1.4.7\n',
        },
        { path: 'DHT.h', content: '#pragma once\n' },
        { path: 'DHT.cpp', content: '#include "DHT.h"\n' },
        { path: 'src/utility/helper.hpp', content: '// helper\n' },
        { path: 'license.txt', content: 'MIT' },
        { path: 'README.md', content: '# readme' },
        { path: 'examples/Test/Test.ino', content: 'void setup() {}' },
        { path: 'docs/index.h', content: '// not built' },
        { path: '.github/workflows/ci.yml', content: 'on: push' },
        { path: 'lib.a', content: Buffer.from([0x21, 0x3c, 0x00, 0x61]) },
      ]),
    );

    const { files, skipped } = await extractLibrary(archive);

    expect(files.map((file) => file.path)).toEqual([
      'DHT.cpp',
      'DHT.h',
      'library.properties',
      'license.txt',
      'src/utility/helper.hpp',
    ]);
    expect(skipped).toBe(5);
  });

  it('unwraps the one folder a GitHub-style archive puts everything in', async () => {
    const archive = gzipSync(
      tarOf([
        { path: 'Lib-1.0/library.json', content: '{"name":"Lib"}' },
        { path: 'Lib-1.0/src/Lib.h', content: '' },
      ]),
    );
    const { files } = await extractLibrary(archive);
    expect(files.map((file) => file.path)).toEqual([
      'library.json',
      'src/Lib.h',
    ]);
  });

  it('never keeps a link, a parent path, or a source file that is really binary', async () => {
    const archive = gzipSync(
      tarOf([
        { path: 'Lib.h', content: '' },
        { path: 'evil.h', content: '', type: '2', link: '/etc/passwd' },
        { path: '../escape.h', content: '' },
        { path: 'blob.c', content: Buffer.from([1, 0, 2]) },
      ]),
    );
    const { files } = await extractLibrary(archive);
    expect(files.map((file) => file.path)).toEqual(['Lib.h']);
  });

  it('honours pax long paths', () => {
    const entries = readTar(
      tarOf([
        { path: 'x', paxPath: 'src/a/very/long/Header.h', content: 'ok' },
      ]),
    );
    expect(entries.map((entry) => entry.path)).toEqual([
      'src/a/very/long/Header.h',
    ]);
  });

  it('refuses a damaged header, a library without headers, and a decompression bomb', async () => {
    const damaged = tarOf([{ path: 'Lib.h', content: '' }]);
    damaged[0] ^= 0xff;
    expect(() => readTar(damaged)).toThrow(LibraryArchiveError);

    await expect(
      extractLibrary(gzipSync(tarOf([{ path: 'only.cpp', content: '' }]))),
    ).rejects.toThrow('no header');

    const bomb = gzipSync(Buffer.alloc(30 * 1024 * 1024));
    await expect(extractLibrary(bomb)).rejects.toThrow(LibraryArchiveError);
  });

  it('removes build scripts from library.json', () => {
    const cleaned = sanitizeLibraryJson(
      JSON.stringify({
        name: 'Lib',
        scripts: { postinstall: 'rm -rf /' },
        build: { extraScript: 'evil.py', flags: '-DLIB' },
      }),
    );
    expect(JSON.parse(cleaned!)).toEqual({
      name: 'Lib',
      build: { flags: '-DLIB' },
    });
    expect(sanitizeLibraryJson('not json')).toBeNull();
  });
});

describe('library manifests', () => {
  it('reads dependencies from library.json first, then library.properties', () => {
    expect(
      libraryDependencies([
        {
          path: 'library.json',
          content: JSON.stringify({
            dependencies: [
              { owner: 'adafruit', name: 'Adafruit BusIO' },
              { name: 'Wire' },
              { name: 'IDF only', frameworks: ['espidf'] },
            ],
          }),
        },
        { path: 'library.properties', content: 'depends=Ignored' },
      ]),
    ).toEqual([{ owner: 'adafruit', name: 'Adafruit BusIO' }]);

    expect(
      libraryDependencies([
        {
          path: 'library.properties',
          content:
            'name=X\ndepends=Adafruit Unified Sensor, SPI, Foo (>=1.2)\n',
        },
      ]),
    ).toEqual([{ name: 'Adafruit Unified Sensor' }, { name: 'Foo' }]);
  });

  it('turns a registry name into a folder the path rules accept', () => {
    expect(libraryFolderName('DHT sensor library')).toBe('DHT_sensor_library');
    expect(libraryFolderName('  ESP Async WebServer! ')).toBe(
      'ESP_Async_WebServer',
    );
    expect(libraryFolderName('***')).toBe('library');
  });
});
