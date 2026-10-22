import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { deviceById } from '../src/app/features/user/workspace/virtual-device/devices/device-catalog';
import { defaultStateFor } from '../src/app/features/user/workspace/virtual-device/devices/core/device-definition';
import type { DeviceBehavior } from '../src/app/features/user/workspace/virtual-device/devices/core/device-simulation';
import { simulateTick } from '../src/app/features/user/workspace/virtual-device/simulation/circuit-simulator';
import {
  attachFirmware,
  clearFirmware,
} from '../src/app/features/user/workspace/virtual-device/simulation/firmware/firmware-bus';
import { FirmwareMachine } from '../src/app/features/user/workspace/virtual-device/simulation/firmware/firmware-machine';
import type { WireConnection } from '../src/app/features/user/workspace/virtual-device/models/virtual-device.model';

interface Example {
  devices: {
    instanceId: string;
    deviceId: string;
    properties?: Record<string, string | number | boolean>;
  }[];
  wires: [string, string, string, string][];
}

export class ExampleRig {
  private readonly behaviors = new Map<string, DeviceBehavior>();
  private result = simulateTick({ devices: [], connections: [], deltaMs: 0 }, this.behaviors);
  readonly devices;
  readonly connections: WireConnection[];
  readonly machine: FirmwareMachine;

  constructor(name: string, omit?: readonly [string, string], source?: string) {
    clearFirmware();
    const root = resolve(process.cwd(), 'examples', name);
    const example = JSON.parse(readFileSync(resolve(root, 'circuit.json'), 'utf8')) as Example;
    this.devices = example.devices.map((part) => {
      const definition = deviceById(part.deviceId);
      assert(definition, `Unknown device: ${part.deviceId}`);
      if (definition.simulation)
        this.behaviors.set(part.instanceId, definition.simulation(part.instanceId));
      return {
        instanceId: part.instanceId,
        definition,
        properties: { ...defaultStateFor(definition.properties), ...part.properties },
      };
    });
    this.connections = example.wires.flatMap(([from, fromPin, to, toPin], index) => {
      for (const [id, pin] of [
        [from, fromPin],
        [to, toPin],
      ])
        assert(
          this.devices
            .find((device) => device.instanceId === id)
            ?.definition.pins.some((candidate) => candidate.name === pin),
          `Unknown endpoint ${id}.${pin}`,
        );
      if (
        omit &&
        ((omit[0] === to && omit[1] === toPin) || (omit[0] === from && omit[1] === fromPin))
      )
        return [];
      return [
        {
          id: `w${index}`,
          start: { type: 'device' as const, deviceId: from, pinId: fromPin },
          end: { type: 'device' as const, deviceId: to, pinId: toPin },
          color: '#000',
          kind: 'signal' as const,
          waypoints: [],
        },
      ];
    });
    const board = this.devices.find((device) => device.instanceId === 'board')!;
    const compiled = FirmwareMachine.compile(
      board.definition,
      source ?? readFileSync(resolve(root, 'main.ino'), 'utf8'),
    );
    assert(compiled.machine, JSON.stringify(compiled.fault));
    this.machine = compiled.machine;
    attachFirmware('board', this.machine);
  }

  tick(count = 10): void {
    for (let i = 0; i < count; i++) {
      this.result = simulateTick(
        { devices: this.devices, connections: this.connections, deltaMs: 50 },
        this.behaviors,
      );
      assert.equal(this.machine.fault, null, JSON.stringify(this.machine.fault));
      assert.equal(this.result.shorts.length, 0, 'Example circuit must not short');
    }
  }

  set(id: string, key: string, value: string | number | boolean): void {
    this.devices.find((device) => device.instanceId === id)!.properties[key] = value;
  }

  runtime(id: string, key: string) {
    return this.result.runtime[id]?.[key];
  }
  serial() {
    return this.machine.takeSerialOutput().join('');
  }
}
