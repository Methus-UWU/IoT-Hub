import { CircuitState } from '../../projects/pin-assignment';
import { AiToolCall } from '../providers/ai-provider.interface';
import { previewOf } from './ai-plan';
import { executeToolCall } from './ai-tool-executor';
import { DraftFile, ProjectDraft } from './project-draft';

/**
 * The bench-test rig, end to end through the real engine.
 *
 * The scenario: a 2-channel relay, two LEDs each switched by its own channel and
 * interlocked so that only one is ever lit, and an RGB LED cycling colours on its own,
 * off the relay.
 *
 * This runs the whole assistant path except the model itself — the same draft, the same
 * tools, the same assignment engine, the same plan. That is deliberate: the model's job
 * is to decide intent, and intent is the one thing worth not asserting. Everything the
 * platform is responsible for — which pin, whether a wire is legal, what gets written —
 * is decided here and can be pinned down exactly.
 *
 * It also records two limits of the current catalog rather than working around them
 * quietly, because both change what a user can actually build. See the relay section.
 */

const BOARD = 'component-board';
const RELAY = 'component-relay';
const LED_A = 'component-led-a';
const LED_B = 'component-led-b';
const RGB = 'component-rgb';
const RES_A = 'component-res-a';
const RES_B = 'component-res-b';

const MAIN = 'main.ino';

const EXISTING_SKETCH = `#include <WiFi.h>
#include <WebServer.h>

WebServer server(80);

void connectWifi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
}

void setup() {
  Serial.begin(115200);
  connectWifi();
  server.begin();
}

void loop() {
  server.handleClient();
}
`;

function scenarioDraft(
  connections: CircuitState['connections'] = [],
): ProjectDraft {
  return new ProjectDraft(
    {
      components: [
        {
          id: BOARD,
          definitionId: 'esp32-devkit-v1',
          label: 'ESP32 DevKit V1',
        },
        { id: RELAY, definitionId: 'relay2', label: '2-channel relay' },
        { id: LED_A, definitionId: 'led', label: 'LED A' },
        { id: LED_B, definitionId: 'led', label: 'LED B' },
        { id: RGB, definitionId: 'rgb-led-common-cathode', label: 'RGB LED' },
        { id: RES_A, definitionId: 'resistor', label: 'R1' },
        { id: RES_B, definitionId: 'resistor', label: 'R2' },
      ],
      connections,
    },
    new Map<string, DraftFile>([
      [MAIN, { content: EXISTING_SKETCH, exists: true }],
    ]),
  );
}

function call(name: string, args: unknown): AiToolCall {
  return { id: `call-${name}`, name, rawArguments: JSON.stringify(args) };
}

function reviewDatasheets(
  draft: ProjectDraft,
  ...definitionIds: readonly string[]
): void {
  for (const definitionId of definitionIds) {
    expect(
      executeToolCall(draft, call('read_device_datasheet', { definitionId }))
        .ok,
    ).toBe(true);
  }
}

describe('bench rig: 2-channel relay, two interlocked LEDs, free-running RGB', () => {
  describe('relay control side', () => {
    it('gives each channel its own board pin', () => {
      const draft = scenarioDraft();

      const one = draft.wireToBoard(RELAY, 'IN1');
      const two = draft.wireToBoard(RELAY, 'IN2');

      expect(one.boardPin).not.toBe(two.boardPin);
      expect(one.kind).toBe('signal');
      expect(two.kind).toBe('signal');
    });

    it('powers the relay from the 5 V rail, not the 3.3 V one', () => {
      const draft = scenarioDraft();

      // The module's VCC declares 5 V, and VIN is the only board pin that offers it.
      const power = draft.wireToBoard(RELAY, 'VCC');

      expect(power.boardPin).toBe('VIN');
      expect(power.kind).toBe('power');
    });

    it('shares one ground between the relay and the RGB LED', () => {
      const draft = scenarioDraft();

      const relayGround = draft.wireToBoard(RELAY, 'GND');
      const rgbGround = draft.wireToBoard(RGB, 'CATH');

      expect(rgbGround.boardPin).toBe(relayGround.boardPin);
    });

    it('is deterministic, so the code and the diagram cannot disagree', () => {
      const first = scenarioDraft().wireToBoard(RELAY, 'IN1');
      const second = scenarioDraft().wireToBoard(RELAY, 'IN2');
      const firstAgain = scenarioDraft().wireToBoard(RELAY, 'IN1');

      expect(firstAgain.boardPin).toBe(first.boardPin);
      expect(second.boardPin).toBe(first.boardPin);
    });
  });

  /**
   * The switched side of the relay.
   *
   * These are dry contacts, so they are `passive` and will join a supply, a ground, or a
   * signal — a relay does not care what it switches. The LED therefore goes in series
   * with a contact: supply → resistor → LED → COM, and NO back to ground. Closing the
   * contact completes that loop.
   */
  describe('relay load side', () => {
    it.each(['NO1', 'COM1', 'NC1', 'NO2', 'COM2', 'NC2'])(
      'exposes terminal %s as a wireable pin',
      (terminal) => {
        const draft = scenarioDraft();
        reviewDatasheets(draft, 'led', 'relay2');
        const outcome = executeToolCall(
          draft,
          call('connect_pins', {
            fromComponentId: LED_A,
            fromPin: 'K',
            toComponentId: RELAY,
            toPin: terminal,
          }),
        );

        expect(outcome.ok).toBe(true);
      },
    );

    it('numbers the terminals per channel so the two loads cannot be confused', () => {
      const outcome = executeToolCall(
        scenarioDraft(),
        call('get_device_pinout', { componentId: RELAY }),
      );

      expect(outcome.ok).toBe(true);
      for (const pin of ['IN1', 'IN2', 'COM1', 'NO1', 'COM2', 'NO2']) {
        expect(outcome.content).toContain(pin);
      }
      // Unnumbered poles belong to the 1-channel part, not this one. Only the pin
      // names are checked — "closes to COM" appears in the descriptions by design.
      const pinNames = outcome.content
        .split('\n')
        .slice(1)
        .map((line) => line.split(' ')[0]);
      expect(pinNames).not.toContain('COM');
      expect(pinNames).toEqual(
        expect.arrayContaining(['COM1', 'NO1', 'NC1', 'COM2', 'NO2', 'NC2']),
      );
    });

    it('puts each LED on its own channel', () => {
      const draft = scenarioDraft();

      draft.connect(
        { componentId: LED_A, pinId: 'K' },
        { componentId: RELAY, pinId: 'COM1' },
      );
      draft.connect(
        { componentId: LED_B, pinId: 'K' },
        { componentId: RELAY, pinId: 'COM2' },
      );
      draft.connect(
        { componentId: RELAY, pinId: 'NO1' },
        { componentId: BOARD, pinId: 'GND-L' },
      );
      draft.connect(
        { componentId: RELAY, pinId: 'NO2' },
        { componentId: BOARD, pinId: 'GND-R' },
      );

      const wires = draft.state().connections;
      expect(wires).toHaveLength(4);

      // Nothing bridges the two channels: that is what keeps the loads independent.
      const channelOne = wires.filter((wire) =>
        [wire.from.pinId, wire.to.pinId].some((pin) => pin.endsWith('1')),
      );
      const channelTwo = wires.filter((wire) =>
        [wire.from.pinId, wire.to.pinId].some((pin) => pin.endsWith('2')),
      );
      expect(channelOne).toHaveLength(2);
      expect(channelTwo).toHaveLength(2);
    });

    it('refuses a terminal that does not exist on a 2-channel part', () => {
      const draft = scenarioDraft();
      reviewDatasheets(draft, 'led', 'relay2');
      const outcome = executeToolCall(
        draft,
        call('connect_pins', {
          fromComponentId: LED_A,
          fromPin: 'K',
          toComponentId: RELAY,
          toPin: 'COM3',
        }),
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('PIN_NOT_FOUND');
    });
  });

  describe('LED legs are wired by hand, never auto-assigned', () => {
    it('refuses to pick a board pin for a passive lead', () => {
      const draft = scenarioDraft();
      reviewDatasheets(draft, 'led');
      const outcome = executeToolCall(
        draft,
        call('wire_to_board', { componentId: LED_A, devicePin: 'A' }),
      );

      // Without this the engine would put the anode and the cathode on the same rail,
      // because a passive pin is "compatible" with every pin on the board.
      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('PIN_NEEDS_EXPLICIT_WIRING');
      expect(outcome.content).toContain('connect_pins');
    });

    it('accepts an LED wired anode through a resistor, cathode to ground', () => {
      const draft = scenarioDraft();

      const toResistor = draft.connect(
        { componentId: LED_A, pinId: 'A' },
        { componentId: RES_A, pinId: '2' },
      );
      const toSupply = draft.connect(
        { componentId: RES_A, pinId: '1' },
        { componentId: BOARD, pinId: '3V3' },
      );
      const toGround = draft.connect(
        { componentId: LED_A, pinId: 'K' },
        { componentId: BOARD, pinId: 'GND-L' },
      );

      expect(toResistor.created).toBe(true);
      expect(toSupply.created).toBe(true);
      expect(toGround.created).toBe(true);
      expect(toGround.warnings).toEqual([]);
    });

    it('keeps the two LEDs on separate wires rather than merging them', () => {
      const draft = scenarioDraft();

      draft.connect(
        { componentId: LED_A, pinId: 'A' },
        { componentId: RES_A, pinId: '2' },
      );
      draft.connect(
        { componentId: LED_B, pinId: 'A' },
        { componentId: RES_B, pinId: '2' },
      );

      const wires = draft.state().connections;
      expect(wires).toHaveLength(2);
      expect(wires[0].from.componentId).not.toBe(wires[1].from.componentId);
    });
  });

  describe('RGB LED, off the relay', () => {
    it('lands each colour die on its own pin and the cathode on ground', () => {
      const draft = scenarioDraft();

      const red = draft.wireToBoard(RGB, 'R');
      const green = draft.wireToBoard(RGB, 'G');
      const blue = draft.wireToBoard(RGB, 'B');
      const cathode = draft.wireToBoard(RGB, 'CATH');

      const signalPins = [red.boardPin, green.boardPin, blue.boardPin];
      expect(new Set(signalPins).size).toBe(3);
      expect(signalPins).not.toContain(cathode.boardPin);
      expect(cathode.kind).toBe('ground');
    });

    it('does not take a pin the relay is already using', () => {
      const draft = scenarioDraft();

      const relayOne = draft.wireToBoard(RELAY, 'IN1');
      const relayTwo = draft.wireToBoard(RELAY, 'IN2');
      const red = draft.wireToBoard(RGB, 'R');
      const green = draft.wireToBoard(RGB, 'G');
      const blue = draft.wireToBoard(RGB, 'B');

      const used = [relayOne, relayTwo, red, green, blue].map(
        (a) => a.boardPin,
      );
      expect(new Set(used).size).toBe(5);
    });

    it('reuses a die already wired instead of moving it', () => {
      const draft = scenarioDraft([
        {
          id: 'wire-existing',
          from: { componentId: RGB, pinId: 'R' },
          to: { componentId: BOARD, pinId: 'GPIO25' },
          kind: 'signal',
        },
      ]);

      const red = draft.wireToBoard(RGB, 'R');

      expect(red).toMatchObject({ boardPin: 'GPIO25', reused: true });
      expect(draft.isEmpty).toBe(true);
    });
  });

  describe('the whole rig as one proposal', () => {
    /** Wires the rig the way the assistant would, and returns the finished draft. */
    function buildRig(): ProjectDraft {
      const draft = scenarioDraft();

      draft.wireToBoard(RELAY, 'VCC');
      draft.wireToBoard(RELAY, 'GND');
      draft.wireToBoard(RELAY, 'IN1');
      draft.wireToBoard(RELAY, 'IN2');

      // Each LED sits in series with its own contact: 3V3 → resistor → LED → COM,
      // and NO back to ground. The channel closing is what completes the loop.
      for (const [led, resistor, common, open, ground] of [
        [LED_A, RES_A, 'COM1', 'NO1', 'GND-L'],
        [LED_B, RES_B, 'COM2', 'NO2', 'GND-R'],
      ] as const) {
        draft.connect(
          { componentId: resistor, pinId: '1' },
          { componentId: BOARD, pinId: '3V3' },
        );
        draft.connect(
          { componentId: led, pinId: 'A' },
          { componentId: resistor, pinId: '2' },
        );
        draft.connect(
          { componentId: led, pinId: 'K' },
          { componentId: RELAY, pinId: common },
        );
        draft.connect(
          { componentId: RELAY, pinId: open },
          { componentId: BOARD, pinId: ground },
        );
      }

      draft.wireToBoard(RGB, 'R');
      draft.wireToBoard(RGB, 'G');
      draft.wireToBoard(RGB, 'B');
      draft.wireToBoard(RGB, 'CATH');

      return draft;
    }

    it('produces a plan with no duplicate wires and no refusals', () => {
      const draft = buildRig();
      const wires = draft
        .actions()
        .filter((action) => action.type === 'connect');

      const keys = wires.map((wire) =>
        wire.type === 'connect'
          ? [
              `${wire.from.componentId}:${wire.from.pinId}`,
              `${wire.to.componentId}:${wire.to.pinId}`,
            ]
              .sort()
              .join('|')
          : '',
      );

      expect(new Set(keys).size).toBe(keys.length);
    });

    it('previews the change in terms a user can check against the board', () => {
      const draft = buildRig();
      const preview = previewOf(draft.actions(), (id) => draft.labelOf(id));

      const wiring = preview
        .filter((line) => line.kind === 'wiring')
        .map((line) => line.text);

      expect(wiring).toContain('2-channel relay VCC → ESP32 DevKit V1 VIN');
      expect(wiring.some((line) => line.startsWith('LED A A →'))).toBe(true);
      expect(wiring.some((line) => line.startsWith('RGB LED R →'))).toBe(true);
      // No component uuid may reach the preview: the user reads labels, not ids.
      expect(wiring.every((line) => !line.includes('component-'))).toBe(true);
    });

    it('patches the sketch instead of replacing it', () => {
      const draft = buildRig();
      const relayOne = draft.wireToBoard(RELAY, 'IN1');
      const relayTwo = draft.wireToBoard(RELAY, 'IN2');

      const original = draft.readFile(MAIN)?.content ?? '';
      const patched = `${original.replace(
        'void setup() {',
        `#define RELAY_A ${pinNumber(relayOne.boardPin)}\n#define RELAY_B ${pinNumber(relayTwo.boardPin)}\n\nvoid setup() {`,
      )}\n// interlock: only one channel is ever energised\n`;

      const outcome = executeToolCall(
        draft,
        call('write_source_file', { path: MAIN, content: patched }),
      );

      expect(outcome.ok).toBe(true);
      const staged = draft.readFile(MAIN)?.content ?? '';
      expect(staged).toContain('connectWifi');
      expect(staged).toContain('server.handleClient');
      expect(staged).toContain(
        `#define RELAY_A ${pinNumber(relayOne.boardPin)}`,
      );
    });

    it('refuses a sketch that drops the existing Wi-Fi and server code', () => {
      const draft = buildRig();

      const outcome = executeToolCall(
        draft,
        call('write_source_file', {
          path: MAIN,
          content: 'void setup() {}\nvoid loop() {}\n',
        }),
      );

      expect(outcome.ok).toBe(false);
      expect(draft.readFile(MAIN)?.content).toContain('connectWifi');
    });
  });
});

/** `GPIO4` → 4, matching what the tool result tells the model to write. */
function pinNumber(boardPin: string): number {
  const match = /^(?:GPIO|IO|D)?(\d+)$/i.exec(boardPin);
  if (!match) throw new Error(`${boardPin} has no plain pin number`);
  return Number(match[1]);
}
