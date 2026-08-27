import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { WorkspaceService } from './workspace.service';

const execFileAsync = promisify(execFile);
const SOURCE_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx', '.ino']);
const HEADER_EXTENSIONS = new Set(['.h', '.hh', '.hpp']);

export interface WorkspaceBuildResult {
  target: 'build' | 'upload';
  success: true;
  output: string;
  durationMs: number;
}

@Injectable()
export class WorkspaceBuildService {
  private readonly activeProjects = new Set<string>();
  private readonly platformioCommand: string;
  private readonly platformioEnvironment: NodeJS.ProcessEnv;

  constructor(
    config: ConfigService,
    private readonly workspace: WorkspaceService,
  ) {
    const command = config.get<string>('PLATFORMIO_COMMAND') ?? 'pio';
    this.platformioCommand = this.resolveCommand(command);
    this.platformioEnvironment = this.buildEnvironment(
      config.get<string>('PLATFORMIO_CORE_DIR'),
    );
  }

  async toolchainStatus() {
    try {
      const { stdout, stderr } = await execFileAsync(
        this.platformioCommand,
        ['--version'],
        {
          env: this.platformioEnvironment,
          timeout: 8_000,
          windowsHide: true,
        },
      );
      return {
        available: true,
        command: this.platformioCommand,
        version: `${stdout}${stderr}`.trim(),
      };
    } catch {
      return {
        available: false,
        command: this.platformioCommand,
        version: null,
      };
    }
  }

  async run(
    userId: string,
    projectId: string,
    target: 'build' | 'upload',
    port?: string,
  ): Promise<WorkspaceBuildResult> {
    const projectKey = `${userId}:${projectId}`;
    if (this.activeProjects.has(projectKey)) {
      throw new ConflictException(
        'A build is already running for this project',
      );
    }
    if (target === 'upload' && !port) {
      throw new UnprocessableEntityException(
        'A device port is required for upload',
      );
    }

    const toolchain = await this.toolchainStatus();
    if (!toolchain.available) {
      throw new ServiceUnavailableException(
        'PlatformIO Core is not installed. Configure PLATFORMIO_COMMAND with the pio executable path.',
      );
    }

    this.activeProjects.add(projectKey);
    const stagingRoot = await fs.mkdtemp(join(tmpdir(), 'iot-hub-build-'));
    const startedAt = Date.now();
    try {
      await this.prepareProject(userId, projectId, stagingRoot);
      const args = ['run', '--project-dir', stagingRoot];
      if (target === 'upload')
        args.push('--target', 'upload', '--upload-port', port!);

      try {
        const { stdout, stderr } = await execFileAsync(
          this.platformioCommand,
          args,
          {
            cwd: stagingRoot,
            env: this.platformioEnvironment,
            timeout: 180_000,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
          },
        );
        return {
          target,
          success: true,
          output: `${stdout}${stderr}`.trim(),
          durationMs: Date.now() - startedAt,
        };
      } catch (error: unknown) {
        const output = this.processOutput(error);
        throw new UnprocessableEntityException({
          message: `PlatformIO ${target} failed`,
          output,
          durationMs: Date.now() - startedAt,
        });
      }
    } finally {
      this.activeProjects.delete(projectKey);
      await fs.rm(stagingRoot, { recursive: true, force: true });
    }
  }

  private async prepareProject(
    userId: string,
    projectId: string,
    stagingRoot: string,
  ): Promise<void> {
    const files = await this.workspace.listFiles(userId, projectId);
    let hasPlatformioConfig = false;

    for (const file of files) {
      const source = await this.workspace.readFile(
        userId,
        projectId,
        file.path,
      );
      const targetPath = this.buildPath(stagingRoot, file.path);
      if (file.path === 'platformio.ini') hasPlatformioConfig = true;
      await fs.mkdir(dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, source.content, 'utf8');
    }

    if (!hasPlatformioConfig) {
      await fs.writeFile(
        join(stagingRoot, 'platformio.ini'),
        '[env:esp32dev]\nplatform = espressif32\nboard = esp32dev\nframework = arduino\nmonitor_speed = 115200\n',
        'utf8',
      );
    }
  }

  private buildPath(stagingRoot: string, filePath: string): string {
    if (filePath.includes('/'))
      return join(stagingRoot, ...filePath.split('/'));
    if (filePath === 'platformio.ini') return join(stagingRoot, filePath);

    const extension = extname(filePath).toLowerCase();
    if (SOURCE_EXTENSIONS.has(extension))
      return join(stagingRoot, 'src', basename(filePath));
    if (HEADER_EXTENSIONS.has(extension))
      return join(stagingRoot, 'include', basename(filePath));
    return join(stagingRoot, filePath);
  }

  private processOutput(error: unknown): string {
    if (!error || typeof error !== 'object')
      return 'PlatformIO exited with an unknown error';
    const processError = error as {
      stdout?: unknown;
      stderr?: unknown;
      message?: unknown;
    };
    const output = [processError.stdout, processError.stderr]
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      )
      .join('\n')
      .trim();
    const message =
      typeof processError.message === 'string'
        ? processError.message
        : 'PlatformIO build failed';
    return output || message;
  }

  private resolveCommand(command: string): string {
    return command.includes('/') || command.includes('\\')
      ? resolve(command)
      : command;
  }

  private buildEnvironment(coreDir?: string): NodeJS.ProcessEnv {
    return coreDir
      ? { ...process.env, PLATFORMIO_CORE_DIR: resolve(coreDir) }
      : process.env;
  }
}
