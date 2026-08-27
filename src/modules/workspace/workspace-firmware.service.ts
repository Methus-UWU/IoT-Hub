import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/**
 * Firmware build, device discovery, and serial monitoring are disabled.
 *
 * The previous implementation ran PlatformIO with `execFile` inside the API
 * process, against a project directory assembled from user-supplied files, and
 * handed the child the entire `process.env` — database URL, JWT secrets, and AI
 * provider keys included. A user-supplied `platformio.ini` can execute arbitrary
 * code through directives such as `extra_scripts`, so that path was remote code
 * execution with full access to platform secrets. It also exposed every serial
 * port on the API host to every authenticated user, with no ownership check.
 *
 * This module deliberately contains no `child_process` import. The capability
 * returns in Phase 4 as a queued job executed by an isolated, ephemeral,
 * resource-limited worker that never receives platform credentials. Physical
 * device flashing moves to the browser (Web Serial) or a trusted local agent,
 * because a server-side worker must not reach a user's hardware.
 *
 * See docs/SECURITY.md ("Temporary capability limitations") and
 * docs/adr/ADR-002-build-isolation.md.
 */
@Injectable()
export class WorkspaceFirmwareService {
  private static readonly DISABLED_MESSAGE =
    'Firmware build and serial access are temporarily disabled while the isolated build worker is being introduced.';

  /**
   * Reported as unavailable rather than probed, so the editor degrades to a
   * clear banner instead of an error state.
   */
  toolchainStatus() {
    return {
      available: false,
      command: null,
      version: null,
      message: WorkspaceFirmwareService.DISABLED_MESSAGE,
    };
  }

  build(): never {
    throw new ServiceUnavailableException({
      code: 'BUILD_TEMPORARILY_DISABLED',
      message: WorkspaceFirmwareService.DISABLED_MESSAGE,
    });
  }

  listDevices() {
    return {
      available: false,
      devices: [],
      message: WorkspaceFirmwareService.DISABLED_MESSAGE,
    };
  }

  startMonitor(): never {
    throw new ServiceUnavailableException({
      code: 'SERIAL_TEMPORARILY_DISABLED',
      message: WorkspaceFirmwareService.DISABLED_MESSAGE,
    });
  }

  /** Idle shape, so an editor that is still polling stops cleanly. */
  monitorOutput() {
    return {
      running: false,
      port: null,
      baud: null,
      exitCode: null,
      cursor: 0,
      lines: [],
    };
  }

  stopMonitor() {
    return { running: false };
  }
}
