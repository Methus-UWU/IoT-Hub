import { AiToolCall } from '../providers/ai-provider.interface';
import { executeToolCall } from './ai-tool-executor';
import { DraftFile, ProjectDraft } from './project-draft';

const BOARD = 'component-board';
const DHT = 'component-dht';

function draftWith(files: Record<string, string> = {}): ProjectDraft {
  return new ProjectDraft(
    {
      components: [
        {
          id: BOARD,
          definitionId: 'esp32-devkit-v1',
          label: 'ESP32 DevKit V1',
        },
        { id: DHT, definitionId: 'dht22', label: 'DHT22' },
      ],
      connections: [],
    },
    new Map<string, DraftFile>(
      Object.entries(files).map(([path, content]) => [
        path,
        { content, exists: true },
      ]),
    ),
  );
}

function call(name: string, args: unknown): AiToolCall {
  return { id: 'call-1', name, rawArguments: JSON.stringify(args) };
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

describe('executeToolCall', () => {
  describe('malformed input', () => {
    it('reports unparsable arguments instead of throwing', () => {
      const outcome = executeToolCall(draftWith(), {
        id: 'call-1',
        name: 'get_board_pinout',
        rawArguments: 'not json',
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('valid JSON');
    });

    it('reports an unknown tool', () => {
      const outcome = executeToolCall(draftWith(), call('drop_database', {}));

      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('Unknown tool');
    });

    it('reports a missing required argument', () => {
      const outcome = executeToolCall(
        draftWith(),
        call('read_source_file', {}),
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('"path" is required');
    });
  });

  describe('reads', () => {
    it('lists the board pins with what occupies them', () => {
      const draft = draftWith();
      draft.wireToBoard(DHT, 'DATA');

      const outcome = executeToolCall(draft, call('get_board_pinout', {}));

      expect(outcome.ok).toBe(true);
      expect(outcome.content).toContain('GPIO4');
      expect(outcome.content).toMatch(/IN USE by DHT22:DATA/);
      expect(outcome.content).toContain('free');
    });

    it('names the onboard LED and its pin, so "blink the LED" needs no new part', () => {
      const outcome = executeToolCall(
        draftWith(),
        call('get_board_pinout', {}),
      );

      expect(outcome.content).toContain('Onboard LED: pin GPIO2');
      expect(outcome.content).toContain('no add_device and no wire');
      expect(outcome.content).toContain('const int LED_PIN = 2;');
    });

    it('returns a file the project has', () => {
      const outcome = executeToolCall(
        draftWith({ 'main.ino': 'void loop() {}' }),
        call('read_source_file', { path: 'main.ino' }),
      );

      expect(outcome.content).toBe('void loop() {}');
    });

    it('names the files that exist when asked for one that does not', () => {
      const outcome = executeToolCall(
        draftWith({ 'main.ino': 'x' }),
        call('read_source_file', { path: 'other.ino' }),
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('main.ino');
    });

    it('refuses a path that escapes the project', () => {
      const outcome = executeToolCall(
        draftWith(),
        call('read_source_file', { path: '../../etc/passwd' }),
      );

      expect(outcome.ok).toBe(false);
    });

    it('searches the catalog by purpose', () => {
      const outcome = executeToolCall(
        draftWith(),
        call('search_device_catalog', { query: 'temperature' }),
      );

      expect(outcome.content).toContain('dht22');
    });
  });

  describe('wiring', () => {
    it('requires the datasheet before adding or wiring a documented part', () => {
      const draft = draftWith();

      const add = executeToolCall(
        draft,
        call('add_device', {
          definitionId: 'dht22',
          wirePins: ['DATA', 'VCC', 'GND'],
        }),
      );
      const wire = executeToolCall(
        draft,
        call('wire_to_board', { componentId: DHT, devicePin: 'DATA' }),
      );

      expect(add.ok).toBe(false);
      expect(wire.ok).toBe(false);
      expect(add.content).toContain('DATASHEET_REQUIRED');
      expect(add.content).toContain('read_device_datasheet');
      expect(draft.actions()).toHaveLength(0);
    });

    it('adds a sensor and wires signal, supply and ground with the existing assignment engine in one call', () => {
      const draft = draftWith();
      reviewDatasheets(draft, 'dht22');
      const result = executeToolCall(
        draft,
        call('add_device', {
          definitionId: 'dht22',
          wirePins: ['DATA', 'VCC', 'GND'],
        }),
      );
      expect(result.ok).toBe(true);
      expect(result.content).toContain('Use 32 as the pin number');
      expect(result.content).toContain('NC');
      expect(
        draft.actions().filter((action) => action.type === 'connect'),
      ).toHaveLength(3);
      expect(
        draft.actions().filter((action) => action.type === 'add_device'),
      ).toHaveLength(0);
      const repeated = executeToolCall(
        draft,
        call('add_device', {
          definitionId: 'dht22',
          wirePins: ['DATA', 'VCC', 'GND'],
        }),
      );
      expect(repeated.ok).toBe(true);
      expect(draft.actions()).toHaveLength(3);
    });

    it.each(
      [
        [],
        ['DATA', 'DATA'],
        [null],
        'DATA',
        Array<string>(17).fill('DATA'),
      ].map((value) => [value]),
    )(
      'refuses malformed bulk wiring before adding a device: %j',
      (wirePins) => {
        const draft = draftWith();
        expect(
          executeToolCall(
            draft,
            call('add_device', {
              definitionId: 'dht22',
              allowDuplicate: true,
              wirePins,
            }),
          ).ok,
        ).toBe(false);
        expect(draft.actions()).toHaveLength(0);
      },
    );

    it('serves the datasheet a part has, and says so in the catalog listing', () => {
      const draft = draftWith();

      const listed = executeToolCall(
        draft,
        call('search_device_catalog', { query: 'dht22' }),
      );
      expect(listed.content).toContain('datasheet');

      const sheet = executeToolCall(
        draft,
        call('read_device_datasheet', { definitionId: 'dht22' }),
      );
      expect(sheet.ok).toBe(true);
      // The requirement no pinout carries: without the pull-up the sensor reads nothing.
      expect(sheet.content).toContain('4.7 kΩ');
      expect(sheet.content).toContain('dht22');
    });

    it('refuses a datasheet for a part that is not in the catalog, and suggests near ids', () => {
      const outcome = executeToolCall(
        draftWith(),
        call('read_device_datasheet', { definitionId: 'dht' }),
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('Did you mean');
    });

    it('reports a failed pin alongside successful staged wires, without wiring an NC pin', () => {
      const draft = draftWith();
      reviewDatasheets(draft, 'dht22');
      const result = executeToolCall(
        draft,
        call('add_device', {
          definitionId: 'dht22',
          wirePins: ['DATA', 'NC', 'GND'],
        }),
      );
      // The pin failed, the device did not: a refusal here would reach the user as a
      // warning about a change that was staged successfully.
      expect(result.ok).toBe(true);
      expect(result.content).toContain('NC: REFUSED:');
      expect(result.content).toContain('component-dht');
      expect(
        draft.actions().filter((action) => action.type === 'connect'),
      ).toHaveLength(2);
    });

    it('tells the model the exact pin number to write in the code', () => {
      const draft = draftWith();
      reviewDatasheets(draft, 'dht22');
      const outcome = executeToolCall(
        draft,
        call('wire_to_board', {
          componentId: DHT,
          devicePin: 'DATA',
          preferredBoardPin: 'GPIO4',
        }),
      );

      expect(outcome.ok).toBe(true);
      expect(outcome.content).toContain('board GPIO4');
      expect(outcome.content).toContain('Use 4 as the pin number');
    });

    it('refuses a preferred pin that cannot serve the signal, with the reason', () => {
      const draft = draftWith();
      reviewDatasheets(draft, 'dht22');
      const outcome = executeToolCall(
        draft,
        call('wire_to_board', {
          componentId: DHT,
          devicePin: 'DATA',
          preferredBoardPin: 'GPIO34',
        }),
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('PIN_CAPABILITY_MISMATCH');
    });

    it('refuses a component id that is not in this project', () => {
      const outcome = executeToolCall(
        draftWith(),
        call('wire_to_board', {
          componentId: 'component-elsewhere',
          devicePin: 'DATA',
        }),
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('COMPONENT_NOT_FOUND');
    });

    it('refuses a wire that would short the supply to ground', () => {
      const outcome = executeToolCall(
        draftWith(),
        call('connect_pins', {
          fromComponentId: BOARD,
          fromPin: '3V3',
          toComponentId: BOARD,
          toPin: 'GND-L',
        }),
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('POWER_GROUND_SHORT');
    });

    it('removes an AI wire that would overvolt a part', () => {
      const draft = draftWith();
      reviewDatasheets(draft, 'rfid-rc522');
      const added = executeToolCall(
        draft,
        call('add_device', { definitionId: 'rfid-rc522' }),
      );
      const componentId = /component id is (\S+?);/.exec(added.content)?.[1];
      expect(componentId).toBeDefined();

      const outcome = executeToolCall(
        draft,
        call('connect_pins', {
          fromComponentId: BOARD,
          fromPin: 'VIN',
          toComponentId: componentId,
          toPin: 'VCC',
        }),
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('UNSAFE_CONNECTION');
      expect(outcome.content).toContain('tops out');
      expect(
        draft.actions().filter((action) => action.type === 'connect'),
      ).toHaveLength(0);
    });
  });

  describe('add_device', () => {
    it('suggests catalog ids when the model invents one', () => {
      const outcome = executeToolCall(
        draftWith(),
        call('add_device', { definitionId: 'dht-22-sensor' }),
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('not in the device catalog');
    });

    it('says it is reusing a part the project already has', () => {
      const draft = draftWith();
      reviewDatasheets(draft, 'dht22');
      const outcome = executeToolCall(
        draft,
        call('add_device', { definitionId: 'dht22' }),
      );

      expect(outcome.content).toContain('already contains');
      expect(outcome.content).toContain(DHT);
    });
  });

  describe('write_source_file', () => {
    it('stages a full-file replacement', () => {
      const draft = draftWith({ 'main.ino': 'void setup() {}' });

      const outcome = executeToolCall(
        draft,
        call('write_source_file', {
          path: 'main.ino',
          content: 'void setup() { Serial.begin(115200); }',
        }),
      );

      expect(outcome.ok).toBe(true);
      expect(draft.actions()).toHaveLength(1);
    });

    it('refuses a rewrite that would delete most of an existing file', () => {
      const draft = draftWith({ 'main.ino': 'x'.repeat(2000) });

      const outcome = executeToolCall(
        draft,
        call('write_source_file', {
          path: 'main.ino',
          content: 'void setup() {}',
        }),
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('Read the file');
      expect(draft.isEmpty).toBe(true);
    });
  });

  describe('parts wired by hand and settings', () => {
    it('tells the model how to wire a button, and reuses it on a retry', () => {
      const draft = draftWith();
      reviewDatasheets(draft, 'button');
      const added = executeToolCall(
        draft,
        call('add_device', { definitionId: 'button', wirePins: ['1'] }),
      );
      expect(added.ok).toBe(true);
      expect(added.content).toContain('INPUT_PULLUP');
      expect(added.content).not.toContain('anode');

      const again = executeToolCall(
        draft,
        call('add_device', { definitionId: 'button', wirePins: ['1'] }),
      );
      expect(again.ok).toBe(true);
      expect(again.device?.created).toBe(false);
      expect(again.content).toContain('Reusing it');
      expect(
        draft.actions().filter((a) => a.type === 'add_device'),
      ).toHaveLength(1);
    });

    it('reuses an explicitly named unit on retry while allowing distinct RGB units', () => {
      const draft = draftWith();
      reviewDatasheets(draft, 'rgb-led-common-cathode');
      const add = (label: string) =>
        executeToolCall(
          draft,
          call('add_device', {
            definitionId: 'rgb-led-common-cathode',
            label,
            allowDuplicate: true,
            wirePins: ['R', 'G', 'B', 'CATH'],
          }),
        );
      const first = add('RGB LED 1');
      const second = add('RGB LED 2');
      const count = draft.actions().length;
      const retry = add('RGB LED 2');
      expect(first.device?.created).toBe(true);
      expect(second.device?.created).toBe(true);
      expect(retry.device?.componentId).toBe(second.device?.componentId);
      expect(retry.device?.created).toBe(false);
      expect(draft.actions()).toHaveLength(count);
      expect(
        draft.actions().filter((action) => action.type === 'add_device'),
      ).toHaveLength(2);
    });

    it('tells the model which library drives a part the simulator can run', () => {
      const draft = draftWith();
      reviewDatasheets(draft, 'oled-096-i2c');
      const added = executeToolCall(
        draft,
        call('add_device', { definitionId: 'oled-096-i2c' }),
      );
      expect(added.content).toContain('library: Adafruit SSD1306');
      expect(added.content).toContain('#include <Adafruit_SSD1306.h>');
      expect(added.content).toContain('display.display()');
    });

    it('moves a ground wired before the signal to the rail on the same side as the part', () => {
      const draft = draftWith();
      reviewDatasheets(draft, 'oled-096-i2c');
      const added = executeToolCall(
        draft,
        call('add_device', { definitionId: 'oled-096-i2c' }),
      );
      const id = /component id is (\S+?);/.exec(added.content)?.[1] ?? '';
      // Ground first, while nothing yet says which side the display belongs on.
      executeToolCall(
        draft,
        call('wire_to_board', { componentId: id, devicePin: 'GND' }),
      );
      executeToolCall(
        draft,
        call('wire_to_board', { componentId: id, devicePin: 'SDA' }),
      );
      draft.alignRails();
      const ground = draft
        .actions()
        .find(
          (action) =>
            action.type === 'connect' &&
            (action.from.pinId === 'GND' || action.to.pinId === 'GND'),
        );
      expect(JSON.stringify(ground)).toContain('GND-R');
    });

    it('refuses to build an RGB light out of single-colour LEDs', () => {
      const draft = draftWith();
      const outcome = executeToolCall(
        draft,
        call('add_device', { definitionId: 'led', label: 'RGB Red' }),
      );
      expect(outcome.ok).toBe(false);
      expect(outcome.content).toContain('rgb-led-common-cathode');
      expect(draft.actions()).toHaveLength(0);
    });

    it('stages a setting the catalog offers and refuses one it does not', () => {
      const draft = draftWith();
      reviewDatasheets(draft, 'led');
      expect(
        executeToolCall(
          draft,
          call('add_device', {
            definitionId: 'led',
            settings: { color: 'green' },
          }),
        ).ok,
      ).toBe(true);
      expect(draft.actions()[0]).toMatchObject({
        settings: { color: 'green' },
      });
      expect(
        executeToolCall(
          draft,
          call('add_device', {
            definitionId: 'led',
            allowDuplicate: true,
            settings: { color: 'purple' },
          }),
        ).ok,
      ).toBe(false);
    });
  });
});
