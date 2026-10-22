import type { BusMessage, BusValue } from '../../devices/core/device-simulation';
import type { VirtualDevice } from '../../models/virtual-device.model';
import { createBoardPinMap, type BoardPinMap } from './board-pins';
import {
  FirmwareRuntimeError,
  Interpreter,
  type FirmwareIo,
  type PinMode,
  type Signal,
} from './interpreter';
import { FirmwareSyntaxError } from './tokenizer';
import { parseFirmware } from './parser';
import type { FirmwareValue } from './firmware-values';

/**
 * One running sketch, bound to one placed board.
 *
 * The machine owns the virtual clock and the pin state; the interpreter owns
 * control flow. Splitting them this way is what lets `delay()` work: the
 * interpreter yields a duration and the machine simply refuses to resume it
 * until enough virtual time has passed, without either side blocking.
 *
 * Execution is budgeted per tick. A sketch that never calls `delay()` therefore
 * runs at whatever rate the budget allows rather than freezing the page — the
 * simulator trades fidelity of timing for a UI that stays alive, which is the
 * right trade for teaching.
 */

/**
 * Statements executed per tick before the machine yields back to the page.
 *
 * A `loop()` with no `delay()` spends the whole budget every tick, on the UI
 * thread. At 20 000 a typical sketch took ~13 ms of each 50 ms tick and the canvas
 * stuttered; 5 000 is still hundreds of passes through such a loop per tick,
 * which is more than any button or sensor change needs to be seen.
 */
const STEP_BUDGET = 5000;

/** Reads the resolved circuit, supplied fresh by the board behaviour each tick. */
export interface PinSampler {
  /** True when the node on this catalog pin is above the logic threshold. */
  readDigital(pinName: string): boolean;
  /** 0–4095 for ESP32, 0–1023 for AVR — scaled by the board's ADC resolution. */
  readAnalog(pinName: string): number;
  /** Data other parts published on the node of this catalog pin. */
  readMessages(pinName: string): readonly BusMessage[];
}

/** Data a library call left on a pin, republished every tick until replaced. */
export interface FirmwareBusOutput {
  readonly pinName: string;
  readonly protocol: string;
  readonly data: Readonly<Record<string, BusValue>>;
}

export interface FirmwarePinOutput {
  readonly mode: PinMode;
  /** 0–1. A digital write is 0 or 1; `analogWrite` lands in between. */
  readonly duty: number;
}

export type FirmwareStatus = 'idle' | 'running' | 'error';

export interface FirmwareFault {
  readonly message: string;
  readonly line: number;
  /** The project file the line is in, for a sketch joined from several files. */
  readonly file?: string;
  /** A parse failure never ran; a runtime fault stopped mid-sketch. */
  readonly phase: 'compile' | 'run';
}

export type FaultLocator = (line: number) => { file: string; line: number };

function located(fault: FirmwareFault, locate: FaultLocator | null | undefined): FirmwareFault {
  if (!locate || fault.line <= 0) return fault;
  const origin = locate(fault.line);
  return { ...fault, file: origin.file, line: origin.line };
}

export class FirmwareMachine {
  private readonly interpreter: Interpreter;
  private readonly pinMap: BoardPinMap;

  /** Pin state keyed by catalog pin name, not by sketch number. */
  private readonly pins = new Map<string, { mode: PinMode; duty: number }>();

  private task: Generator<Signal, unknown> | null = null;
  private phase: 'globals' | 'setup' | 'loop' = 'globals';
  private clockMs = 0;
  private resumeAtMs = 0;
  private sampler: PinSampler | null = null;
  private serial: string[] = [];
  private baud = 0;
  private readonly bus = new Map<string, FirmwareBusOutput>();
  /** Pins playing a tone with a duration, and the virtual time it ends. */
  private readonly toneEnds = new Map<string, number>();
  private i2c: { sda: string | null; scl: string | null };
  private spi: { mosi: string | null; miso: string | null; clock: string | null };

  status: FirmwareStatus = 'idle';
  fault: FirmwareFault | null = null;
  /** Maps a line of the joined source back to the project file it came from. */
  private locate: FaultLocator | null = null;

  private constructor(board: VirtualDevice, source: string) {
    this.pinMap = createBoardPinMap(board);
    this.spi = board.defaultSpi
      ? {
          mosi: board.defaultSpi.mosi,
          miso: board.defaultSpi.miso,
          clock: board.defaultSpi.clock,
        }
      : {
          mosi: board.pins.find((pin) => pin.type === 'spi-mosi')?.name ?? null,
          miso: board.pins.find((pin) => pin.type === 'spi-miso')?.name ?? null,
          clock: board.pins.find((pin) => pin.type === 'spi-sck')?.name ?? null,
        };
    // The board's own I2C pins, until the sketch moves the bus with Wire.begin().
    this.i2c = {
      sda: board.pins.find((pin) => pin.type === 'i2c-sda')?.name ?? null,
      scl: board.pins.find((pin) => pin.type === 'i2c-scl')?.name ?? null,
    };
    const avr = ['arduino-uno-r3', 'arduino-nano', 'arduino-mega-2560'].includes(board.id);
    this.interpreter = new Interpreter(
      parseFirmware(source),
      this.createIo(),
      avr ? 2 : 4,
      boardConstants(board),
    );
  }

  /**
   * Compiles a sketch. Returns the fault instead of throwing, because a syntax
   * error is a normal outcome the page has to display, not an exceptional one.
   */
  static compile(
    board: VirtualDevice,
    source: string,
    locate?: FaultLocator,
  ): { machine: FirmwareMachine; fault: null } | { machine: null; fault: FirmwareFault } {
    try {
      const machine = new FirmwareMachine(board, source);
      machine.locate = locate ?? null;
      machine.task = machine.interpreter.initGlobals();
      machine.status = 'running';
      return { machine, fault: null };
    } catch (error) {
      if (error instanceof FirmwareSyntaxError) {
        return {
          machine: null,
          fault: located({ message: error.message, line: error.line, phase: 'compile' }, locate),
        };
      }
      throw error;
    }
  }

  /** Milliseconds of virtual time since the sketch started. */
  get uptimeMs(): number {
    return this.clockMs;
  }

  /** Rate the sketch passed to `Serial.begin`, or 0 until it calls it. */
  get serialBaud(): number {
    return this.baud;
  }

  /** Lines the sketch has printed, oldest first. */
  takeSerialOutput(): readonly string[] {
    if (!this.serial.length) return [];
    const output = this.serial;
    this.serial = [];
    return output;
  }

  /** Current drive state of every pin the sketch has configured as an output. */
  outputs(): ReadonlyMap<string, FirmwarePinOutput> {
    const outputs = new Map<string, FirmwarePinOutput>();
    for (const [name, state] of this.pins) {
      if (state.mode !== 'output') continue;
      outputs.set(name, { mode: state.mode, duty: state.duty });
    }
    return outputs;
  }

  /** What library calls have put on the wires: a display frame, a servo angle. */
  busOutputs(): readonly FirmwareBusOutput[] {
    return [...this.bus.values()];
  }

  /** Pins the sketch set to `INPUT_PULLUP`, which drive weakly high. */
  pullupPins(): readonly string[] {
    return [...this.pins.entries()]
      .filter(([, state]) => state.mode === 'input_pullup')
      .map(([name]) => name);
  }

  /**
   * Advances the sketch by one tick of real time.
   *
   * `sampler` is only valid for the duration of the call: it reads the node
   * state the solver resolved on the previous pass, and holding it past the tick
   * would let the sketch read stale voltages.
   */
  advance(deltaMs: number, sampler: PinSampler): void {
    if (this.status !== 'running') return;

    this.clockMs += Math.max(0, deltaMs);
    // `tone(pin, hz, ms)` ends on its own, whether or not the sketch is waiting.
    for (const [name, endsAt] of this.toneEnds) {
      if (this.clockMs >= endsAt) this.stopTone(name);
    }
    this.sampler = sampler;
    try {
      this.runInterrupts();
      if (this.clockMs < this.resumeAtMs) return;
      this.runBudget();
    } catch (error) {
      this.status = 'error';
      this.task = null;
      this.fault =
        error instanceof FirmwareRuntimeError
          ? located({ message: error.message, line: error.line, phase: 'run' }, this.locate)
          : { message: String(error), line: 0, phase: 'run' };
    } finally {
      this.sampler = null;
    }
  }

  private runInterrupts(): void {
    const task = this.interpreter.serviceInterrupts();
    for (let steps = 0; steps < 1000; steps++) {
      const next = task.next();
      if (next.done) return;
      if (next.value.type === 'delay') {
        throw new FirmwareRuntimeError('ห้ามเรียก delay() ภายใน interrupt callback', 0);
      }
    }
    throw new FirmwareRuntimeError('interrupt callback ทำงานนานเกินขีดจำกัด', 0);
  }

  private runBudget(): void {
    let steps = 0;

    while (steps < STEP_BUDGET) {
      if (!this.task) {
        this.task = this.nextTask();
        // Nothing left to run: a sketch with a `setup()` but no `loop()` is
        // finished rather than broken, so it stops without a fault.
        if (!this.task) {
          this.status = 'idle';
          return;
        }
      }

      const next = this.task.next();
      if (next.done) {
        this.task = null;
        // An empty `loop()` yields nothing at all, so finishing has to cost a
        // step. Without this the machine restarts it forever inside one tick and
        // the budget never advances.
        steps++;
        continue;
      }

      const signal = next.value;
      if (signal.type === 'delay') {
        this.resumeAtMs = this.clockMs + signal.ms;
        return;
      }
      steps++;
    }
  }

  /** Advances the sketch lifecycle: globals, then `setup()`, then `loop()` forever. */
  private nextTask(): Generator<Signal, unknown> | null {
    if (this.phase === 'globals') {
      this.phase = 'setup';
      if (this.interpreter.hasFunction('setup')) return this.interpreter.callFunction('setup');
    }
    if (this.phase === 'setup') {
      this.phase = 'loop';
    }
    if (!this.interpreter.hasFunction('loop')) return null;
    return this.interpreter.callFunction('loop');
  }

  private stopTone(name: string): void {
    this.bus.delete(`${name}|tone`);
    this.toneEnds.delete(name);
    const state = this.pins.get(name);
    if (state) state.duty = 0;
  }

  private createIo(): FirmwareIo {
    const resolve = (pin: number, action: string): string => {
      const name = this.pinMap.nameFor(pin);
      if (!name) {
        throw new FirmwareRuntimeError(`บอร์ดนี้ไม่มีขา ${pin} ที่จะ${action}`, 0);
      }
      return name;
    };

    const stateFor = (name: string) => {
      const existing = this.pins.get(name);
      if (existing) return existing;
      const created = { mode: 'input' as PinMode, duty: 0 };
      this.pins.set(name, created);
      return created;
    };

    return {
      pinMode: (pin, mode) => {
        const state = stateFor(resolve(pin, 'ตั้งโหมด'));
        state.mode = mode;
        // Switching a pin away from output must stop it driving, or the last
        // level it wrote would stay on the node forever.
        if (mode !== 'output') state.duty = 0;
      },

      digitalWrite: (pin, high) => {
        const name = resolve(pin, 'เขียนค่า');
        const state = stateFor(name);
        // A sketch that writes without calling pinMode is relying on undefined
        // behaviour on real hardware. Treating the write as intent to output is
        // the reading that makes the circuit behave the way the author expected.
        if (state.mode !== 'output') state.mode = 'output';
        state.duty = high ? 1 : 0;
      },

      analogWrite: (pin, value) => {
        const name = resolve(pin, 'เขียนค่า PWM');
        const state = stateFor(name);
        if (state.mode !== 'output') state.mode = 'output';
        state.duty = Math.min(1, Math.max(0, value / 255));
      },

      // A tone is a 50 % square wave, which is what the pin's level averages to,
      // plus its pitch on the wire for a buzzer to sound at.
      tone: (pin, hz, durationMs) => {
        const name = resolve(pin, 'เล่นเสียง');
        const state = stateFor(name);
        state.mode = 'output';
        state.duty = 0.5;
        this.bus.set(`${name}|tone`, { pinName: name, protocol: 'tone', data: { hz } });
        if (durationMs !== undefined && durationMs > 0) {
          this.toneEnds.set(name, this.clockMs + durationMs);
        } else {
          this.toneEnds.delete(name);
        }
      },

      noTone: (pin) => {
        this.stopTone(resolve(pin, 'หยุดเสียง'));
      },

      digitalRead: (pin) => {
        const name = resolve(pin, 'อ่านค่า');
        const state = stateFor(name);
        if (state.mode === 'output') return state.duty >= 0.5;
        return this.sampler?.readDigital(name) ?? false;
      },

      analogRead: (pin) => {
        const name = resolve(pin, 'อ่านค่าแอนะล็อก');
        stateFor(name);
        return Math.round(this.sampler?.readAnalog(name) ?? 0);
      },

      serialBegin: (baud) => {
        if (Number.isFinite(baud) && baud > 0) this.baud = Math.round(baud);
      },

      serialWrite: (text) => {
        this.serial.push(text);
        // A runaway print loop must not grow without bound between reads.
        if (this.serial.length > 500) this.serial.splice(0, this.serial.length - 500);
      },

      now: () => this.clockMs,

      library: {
        pinName: (pin) => this.pinMap.nameFor(pin),
        messages: (pinName) => this.sampler?.readMessages(pinName) ?? [],
        publish: (pinName, key, protocol, data) => {
          this.bus.set(`${pinName}|${key}`, { pinName, protocol, data });
        },
        i2cPins: () => this.i2c,
        spiPins: () => this.spi,
        setSpiPins: (clock, miso, mosi) => {
          this.spi = { clock, miso, mosi };
        },
        setI2cPins: (sda, scl) => {
          this.i2c = { sda, scl };
        },
        now: () => this.clockMs,
      },
    };
  }
}

/**
 * Core constants that differ by board. `LED_BUILTIN` is the board's own LED pin
 * — GPIO2 on an ESP32 DevKit, 13 on an Uno — rather than the Uno's 13 everywhere.
 */
function boardConstants(board: VirtualDevice): Record<string, FirmwareValue> {
  const pinNumber = board.onboardLed?.pin.match(/(\d+)$/)?.[1];
  return pinNumber ? { LED_BUILTIN: Number(pinNumber) } : {};
}
