import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { gzipSync } from 'node:zlib';

import { ProjectFilesService } from '../projects/project-files.service';
import { FakeProjectFileRepository } from '../projects/project-files.fake';
import { LibrariesService } from './libraries.service';
import {
  LibraryDetails,
  LibraryRegistry,
  LibraryRegistryError,
  LibraryRelease,
  LibrarySearchPage,
  LibrarySummary,
} from './library-registry';
import { TestTarEntry, tarOf } from './library-test-archive';

const PROJECT = 'project-1';

interface FakePackage {
  owner: string;
  name: string;
  version: string;
  frameworks?: string[];
  files: TestTarEntry[];
}

class FakeRegistry extends LibraryRegistry {
  readonly packages: FakePackage[] = [];
  downloads = 0;
  unavailable = false;

  search(): Promise<LibrarySearchPage> {
    return Promise.resolve({ total: 0, page: 1, items: [] });
  }

  details(): Promise<LibraryDetails> {
    return Promise.reject(new LibraryRegistryError('not_found', 'missing'));
  }

  release(owner: string, name: string): Promise<LibraryRelease> {
    if (this.unavailable) {
      return Promise.reject(new LibraryRegistryError('unavailable', 'down'));
    }
    const found = this.find(owner, name);
    if (!found)
      return Promise.reject(new LibraryRegistryError('not_found', 'missing'));
    return Promise.resolve({
      owner: found.owner,
      name: found.name,
      version: found.version,
      frameworks: found.frameworks ?? ['arduino'],
      downloadUrl: `https://dl.registry.platformio.org/${found.name}.tar.gz`,
      sha256: 'a'.repeat(64),
      size: 100,
    });
  }

  findByName(name: string): Promise<LibrarySummary | null> {
    const found = this.packages.find(
      (entry) => entry.name.toLowerCase() === name.toLowerCase(),
    );
    return Promise.resolve(
      found
        ? {
            owner: found.owner,
            name: found.name,
            description: '',
            version: found.version,
            releasedAt: null,
            updatedAt: null,
            popularityRank: 1,
            stars: 0,
            keywords: [],
          }
        : null,
    );
  }

  download(release: LibraryRelease): Promise<Buffer> {
    this.downloads++;
    const found = this.find(release.owner, release.name)!;
    return Promise.resolve(gzipSync(tarOf(found.files)));
  }

  private find(owner: string, name: string) {
    return this.packages.find(
      (entry) => entry.owner === owner && entry.name === name,
    );
  }
}

const dht: FakePackage = {
  owner: 'adafruit',
  name: 'DHT sensor library',
  version: '1.4.7',
  files: [
    {
      path: 'library.properties',
      content:
        'name=DHT sensor library\ndepends=Adafruit Unified Sensor, Missing Thing\n',
    },
    { path: 'DHT.h', content: '#pragma once\n' },
    { path: 'DHT.cpp', content: '#include "DHT.h"\n' },
    { path: 'examples/DHTtester/DHTtester.ino', content: 'void setup() {}' },
  ],
};

const unified: FakePackage = {
  owner: 'adafruit',
  name: 'Adafruit Unified Sensor',
  version: '1.1.15',
  files: [{ path: 'Adafruit_Sensor.h', content: '#pragma once\n' }],
};

describe('LibrariesService', () => {
  let repository: FakeProjectFileRepository;
  let registry: FakeRegistry;
  let service: LibrariesService;

  beforeEach(() => {
    repository = new FakeProjectFileRepository();
    registry = new FakeRegistry();
    registry.packages.push(dht, unified);
    service = new LibrariesService(
      registry,
      new ProjectFilesService(repository),
    );
    repository.seed(
      PROJECT,
      'src/main.ino',
      'void setup() {}\nvoid loop() {}\n',
    );
  });

  it('installs a library and its dependencies under lib/, with a marker each', async () => {
    const outcome = await service.install(PROJECT, {
      owner: 'adafruit',
      name: 'DHT sensor library',
    });

    expect(outcome.installed.map((entry) => entry.folder)).toEqual([
      'DHT_sensor_library',
      'Adafruit_Unified_Sensor',
    ]);
    expect(outcome.skipped).toEqual([
      { name: 'Missing Thing', reason: 'Not found in the registry.' },
    ]);
    const paths = (await repository.list(PROJECT))
      .map((file) => file.path)
      .sort();
    expect(paths).toEqual([
      'lib/Adafruit_Unified_Sensor/Adafruit_Sensor.h',
      'lib/Adafruit_Unified_Sensor/library-source.json',
      'lib/DHT_sensor_library/DHT.cpp',
      'lib/DHT_sensor_library/DHT.h',
      'lib/DHT_sensor_library/library-source.json',
      'lib/DHT_sensor_library/library.properties',
      'src/main.ino',
    ]);

    const listed = await service.list(PROJECT);
    expect(
      listed.map((library) => [
        library.name,
        library.version,
        library.fileCount,
      ]),
    ).toEqual([
      ['Adafruit Unified Sensor', '1.1.15', 2],
      ['DHT sensor library', '1.4.7', 4],
    ]);
  });

  it('replaces the installed version without re-adding dependencies the project has', async () => {
    await service.install(PROJECT, {
      owner: 'adafruit',
      name: 'DHT sensor library',
    });
    dht.files.push({ path: 'DHT_U.h', content: '' });
    registry.downloads = 0;

    const outcome = await service.install(PROJECT, {
      owner: 'adafruit',
      name: 'DHT sensor library',
    });

    expect(outcome.installed.map((entry) => entry.name)).toEqual([
      'DHT sensor library',
    ]);
    expect(registry.downloads).toBe(1);
    expect(
      await repository.exists(PROJECT, 'lib/DHT_sensor_library/DHT_U.h'),
    ).toBe(true);
    dht.files.pop();
  });

  it('never overwrites a lib/ folder the user wrote', async () => {
    repository.seed(PROJECT, 'lib/DHT_sensor_library/DHT.h', '// mine');

    await expect(
      service.install(PROJECT, {
        owner: 'adafruit',
        name: 'DHT sensor library',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (await repository.read(PROJECT, 'lib/DHT_sensor_library/DHT.h'))?.content,
    ).toBe('// mine');
    await expect(
      service.remove(PROJECT, 'DHT_sensor_library'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removes an installed library folder and nothing else', async () => {
    await service.install(PROJECT, {
      owner: 'adafruit',
      name: 'DHT sensor library',
    });

    const result = await service.remove(PROJECT, 'DHT_sensor_library');

    expect(result.removed).toBe(4);
    expect(
      (await service.list(PROJECT)).map((library) => library.name),
    ).toEqual(['Adafruit Unified Sensor']);
    expect(await repository.exists(PROJECT, 'src/main.ino')).toBe(true);
  });

  it('writes nothing when the project quota would be broken', async () => {
    for (let index = 0; index < 499; index++) {
      repository.seed(PROJECT, `src/file${index}.h`, '');
    }

    await expect(
      service.install(PROJECT, {
        owner: 'adafruit',
        name: 'DHT sensor library',
      }),
    ).rejects.toMatchObject({
      response: { code: 'PROJECT_FILE_LIMIT_REACHED' },
    });
    expect(await service.list(PROJECT)).toEqual([]);
  });

  it('answers 502 when the registry is down', async () => {
    registry.unavailable = true;
    await expect(
      service.install(PROJECT, {
        owner: 'adafruit',
        name: 'DHT sensor library',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
