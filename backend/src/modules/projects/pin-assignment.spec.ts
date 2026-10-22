import {
  CircuitState,
  WiringError,
  assignBoardPin,
  findBoard,
  pinoutOf,
  resolveComponent,
  validateConnection,
} from './pin-assignment';

/**
 * These run against the real generated catalog rather than a fixture.
 *
 * The point of the engine is that it agrees with the parts the canvas draws; a fake
 * pinout would let a rule pass here and refuse a legal wire in the product. Every pin id
 * below is one an ESP32 DevKit V1, a DHT22, or an SSD1306 actually has.
 */

const BOARD = 'component-board';
const DHT = 'component-dht';
const OLED = 'component-oled';
const LED = 'component-led';

function stateWith(
  connections: CircuitState['connections'] = [],
): CircuitState {
  return {
    components: [
      { id: BOARD, definitionId: 'esp32-devkit-v1', label: 'ESP32 DevKit V1' },
      { id: DHT, definitionId: 'dht22', label: 'DHT22' },
      { id: OLED, definitionId: 'oled-096-i2c', label: 'OLED' },
      { id: LED, definitionId: 'led', label: 'LED' },
    ],
    connections,
  };
}

function wire(
  id: string,
  from: { componentId: string; pinId: string },
  to: { componentId: string; pinId: string },
  kind: 'power' | 'ground' | 'signal' = 'signal',
): CircuitState['connections'][number] {
  return { id, from, to, kind };
}

describe('pin assignment', () => {
  describe('validateConnection', () => {
    it('accepts a data line onto a general purpose pin and canonicalises the ids', () => {
      // "D4" is what the silkscreen prints; "GPIO4" is what the wire must be stored on.
      const result = validateConnection(
        stateWith(),
        { componentId: DHT, pinId: 'data' },
        { componentId: BOARD, pinId: 'D4' },
      );

      expect(result.from).toEqual({ componentId: DHT, pinId: 'DATA' });
      expect(result.to).toEqual({ componentId: BOARD, pinId: 'GPIO4' });
      expect(result.kind).toBe('signal');
      expect(result.color).toBe('#22c55e');
      expect(result.warnings).toEqual([]);
    });

    it('refuses a pin the part does not have', () => {
      expect(() =>
        validateConnection(
          stateWith(),
          { componentId: DHT, pinId: 'GPIO99' },
          { componentId: BOARD, pinId: 'GPIO4' },
        ),
      ).toThrow(expect.objectContaining({ code: 'PIN_NOT_FOUND' }));
    });

    it('refuses a component that is not in this project', () => {
      expect(() =>
        validateConnection(
          stateWith(),
          { componentId: 'component-from-another-project', pinId: 'DATA' },
          { componentId: BOARD, pinId: 'GPIO4' },
        ),
      ).toThrow(expect.objectContaining({ code: 'COMPONENT_NOT_FOUND' }));
    });

    it('refuses a signal pin wired to a supply pin', () => {
      expect(() =>
        validateConnection(
          stateWith(),
          { componentId: DHT, pinId: 'DATA' },
          { componentId: BOARD, pinId: '3V3' },
        ),
      ).toThrow(expect.objectContaining({ code: 'PIN_KIND_MISMATCH' }));
    });

    it('refuses a dead short from the supply to ground', () => {
      expect(() =>
        validateConnection(
          stateWith(),
          { componentId: BOARD, pinId: '3V3' },
          { componentId: BOARD, pinId: 'GND-L' },
        ),
      ).toThrow(expect.objectContaining({ code: 'POWER_GROUND_SHORT' }));
    });

    it('refuses a pin connected to itself', () => {
      expect(() =>
        validateConnection(
          stateWith(),
          { componentId: BOARD, pinId: 'GPIO4' },
          { componentId: BOARD, pinId: 'D4' },
        ),
      ).toThrow(expect.objectContaining({ code: 'CONNECTION_SELF_LOOP' }));
    });

    it('refuses a wire that already exists, in either direction', () => {
      const state = stateWith([
        wire(
          'w1',
          { componentId: BOARD, pinId: 'GPIO4' },
          { componentId: DHT, pinId: 'DATA' },
        ),
      ]);

      expect(() =>
        validateConnection(
          state,
          { componentId: DHT, pinId: 'DATA' },
          { componentId: BOARD, pinId: 'GPIO4' },
        ),
      ).toThrow(expect.objectContaining({ code: 'CONNECTION_ALREADY_EXISTS' }));
    });

    it('refuses a pin that is not connected internally', () => {
      expect(() =>
        validateConnection(
          stateWith(),
          { componentId: DHT, pinId: 'NC' },
          { componentId: BOARD, pinId: 'GPIO4' },
        ),
      ).toThrow(
        expect.objectContaining({ code: 'PIN_NOT_CONNECTED_INTERNALLY' }),
      );
    });

    it('warns rather than refuses when a rail exceeds what a part is rated for', () => {
      // A four-cell AA pack is 6 V; the OLED tops out at 5. Real bench work does this
      // deliberately often enough that refusing would be wrong more often than right.
      const state: CircuitState = {
        components: [
          ...stateWith().components,
          {
            id: 'component-battery',
            definitionId: 'battery-aa-4',
            label: 'AA ×4',
          },
        ],
        connections: [],
      };

      const result = validateConnection(
        state,
        { componentId: 'component-battery', pinId: '+' },
        { componentId: OLED, pinId: 'VCC' },
      );

      expect(result.kind).toBe('power');
      expect(result.warnings.map((warning) => warning.code)).toContain(
        'overvoltage',
      );
    });

    it('warns when a rail is below what a part needs to run', () => {
      const state: CircuitState = {
        components: [
          ...stateWith().components,
          { id: 'component-relay', definitionId: 'relay2', label: 'Relay' },
        ],
        connections: [],
      };

      const result = validateConnection(
        state,
        { componentId: BOARD, pinId: '3V3' },
        { componentId: 'component-relay', pinId: 'VCC' },
      );

      expect(result.warnings.map((warning) => warning.code)).toContain(
        'undervoltage',
      );
    });

    it('says nothing about voltage when the rail is in range', () => {
      const result = validateConnection(
        stateWith(),
        { componentId: BOARD, pinId: '3V3' },
        { componentId: OLED, pinId: 'VCC' },
      );

      expect(result.warnings).toEqual([]);
    });

    it('warns about UART polarity and unsafe logic levels', () => {
      const state: CircuitState = {
        components: [
          { id: 'uno', definitionId: 'arduino-uno-r3', label: 'Uno' },
          { id: 'bluetooth', definitionId: 'hc05-bluetooth', label: 'HC-05' },
        ],
        connections: [],
      };

      const polarity = validateConnection(
        state,
        { componentId: 'uno', pinId: 'TX1' },
        { componentId: 'bluetooth', pinId: 'TXD' },
      );
      expect(polarity.warnings.map((warning) => warning.code)).toContain(
        'uart-polarity',
      );

      const level = validateConnection(
        state,
        { componentId: 'uno', pinId: 'TX1' },
        { componentId: 'bluetooth', pinId: 'RXD' },
      );
      expect(level.warnings.map((warning) => warning.code)).toContain(
        'logic-overvoltage',
      );
    });

    it('warns when a second SPI peripheral reuses a chip-select pin', () => {
      const state: CircuitState = {
        components: [
          { id: BOARD, definitionId: 'esp32-devkit-v1', label: 'ESP32' },
          { id: 'reader', definitionId: 'rfid-rc522', label: 'RC522' },
          { id: 'display', definitionId: 'tft-ili9341-touch', label: 'TFT' },
        ],
        connections: [
          wire(
            'existing-cs',
            { componentId: BOARD, pinId: 'GPIO5' },
            { componentId: 'reader', pinId: 'SDA' },
          ),
        ],
      };
      const result = validateConnection(
        state,
        { componentId: BOARD, pinId: 'GPIO5' },
        { componentId: 'display', pinId: 'CS' },
      );
      expect(result.warnings.map((warning) => warning.code)).toContain(
        'spi-cs-conflict',
      );
    });

    it('lets a passive lead join a ground net', () => {
      const result = validateConnection(
        stateWith(),
        { componentId: LED, pinId: 'K' },
        { componentId: BOARD, pinId: 'GND-L' },
      );

      expect(result.kind).toBe('ground');
      expect(result.color).toBe('#111827');
    });
  });

  describe('assignBoardPin', () => {
    const board = {
      id: BOARD,
      definitionId: 'esp32-devkit-v1',
      label: 'ESP32',
    };
    const dht = { id: DHT, definitionId: 'dht22', label: 'DHT22' };
    const oled = { id: OLED, definitionId: 'oled-096-i2c', label: 'OLED' };

    it('puts SPI signals on the ESP32 default VSPI pins', () => {
      const reader = {
        id: 'component-rfid',
        definitionId: 'rfid-rc522',
        label: 'RC522',
      };
      const state: CircuitState = {
        components: [board, reader],
        connections: [],
      };

      expect(
        assignBoardPin(state, board, reader, { peripheralPinId: 'MOSI' })
          .boardPin,
      ).toBe('GPIO23');
      expect(
        assignBoardPin(state, board, reader, { peripheralPinId: 'MISO' })
          .boardPin,
      ).toBe('GPIO19');
      expect(
        assignBoardPin(state, board, reader, { peripheralPinId: 'SCK' })
          .boardPin,
      ).toBe('GPIO18');
      expect(
        assignBoardPin(state, board, reader, { peripheralPinId: 'SDA' })
          .boardPin,
      ).toBe('GPIO5');
    });

    it('reuses the pin a peripheral is already wired to', () => {
      const state = stateWith([
        wire(
          'w1',
          { componentId: DHT, pinId: 'DATA' },
          { componentId: BOARD, pinId: 'GPIO27' },
        ),
      ]);

      const assignment = assignBoardPin(state, board, dht, {
        peripheralPinId: 'DATA',
      });

      expect(assignment).toEqual({
        peripheralPin: 'DATA',
        boardPin: 'GPIO27',
        kind: 'signal',
        reused: true,
      });
    });

    it('honours a caller preference when it is legal and free', () => {
      const assignment = assignBoardPin(stateWith(), board, dht, {
        peripheralPinId: 'DATA',
        preferredBoardPinId: 'GPIO4',
      });

      expect(assignment.boardPin).toBe('GPIO4');
      expect(assignment.reused).toBe(false);
    });

    it('refuses a preference already carrying a wire', () => {
      const state = stateWith([
        wire(
          'w1',
          { componentId: OLED, pinId: 'SDA' },
          { componentId: BOARD, pinId: 'GPIO4' },
        ),
      ]);

      expect(() =>
        assignBoardPin(state, board, dht, {
          peripheralPinId: 'DATA',
          preferredBoardPinId: 'GPIO4',
        }),
      ).toThrow(expect.objectContaining({ code: 'PIN_ALREADY_IN_USE' }));
    });

    it('refuses an input-only ADC pin for a bidirectional data line', () => {
      // GPIO34 on an ESP32 is analog-in only; a one-wire bus cannot live there.
      expect(() =>
        assignBoardPin(stateWith(), board, dht, {
          peripheralPinId: 'DATA',
          preferredBoardPinId: 'GPIO34',
        }),
      ).toThrow(expect.objectContaining({ code: 'PIN_CAPABILITY_MISMATCH' }));
    });

    it('puts an I2C data line on the board default SDA pin', () => {
      const assignment = assignBoardPin(stateWith(), board, oled, {
        peripheralPinId: 'SDA',
      });

      expect(assignment.boardPin).toBe('GPIO21');
    });

    it('shares one supply pin across peripherals', () => {
      const state = stateWith([
        wire(
          'w1',
          { componentId: OLED, pinId: 'VCC' },
          { componentId: BOARD, pinId: '3V3' },
          'power',
        ),
      ]);

      const assignment = assignBoardPin(state, board, dht, {
        peripheralPinId: 'VCC',
      });

      expect(assignment.boardPin).toBe('3V3');
      expect(assignment.kind).toBe('power');
    });

    it('does not hand the same signal pin to a second peripheral', () => {
      const state = stateWith([
        wire(
          'w1',
          { componentId: OLED, pinId: 'SDA' },
          { componentId: BOARD, pinId: 'GPIO21' },
        ),
      ]);

      const assignment = assignBoardPin(state, board, dht, {
        peripheralPinId: 'DATA',
      });

      expect(assignment.boardPin).not.toBe('GPIO21');
    });

    it('powers a 5 V part from the 5 V rail rather than the first rail on the header', () => {
      const relay = {
        id: 'component-relay',
        definitionId: 'relay2',
        label: 'Relay',
      };
      const state: CircuitState = {
        components: [board, relay],
        connections: [],
      };

      // 3V3 comes first in the ESP32 header, but the relay coil needs 4.5–5.5 V.
      expect(
        assignBoardPin(state, board, relay, { peripheralPinId: 'VCC' })
          .boardPin,
      ).toBe('VIN');
    });

    it('keeps a part on the lowest rail it is rated for', () => {
      // The DHT22 window is 3–5.5 V and its datasheet prefers 5 V, but its data line
      // talks to a 3.3 V GPIO, so 3V3 is the rail that matches the board.
      expect(
        assignBoardPin(stateWith(), board, dht, { peripheralPinId: 'VCC' })
          .boardPin,
      ).toBe('3V3');
      expect(
        assignBoardPin(stateWith(), board, oled, { peripheralPinId: 'VCC' })
          .boardPin,
      ).toBe('3V3');
    });

    it('honours a caller who explicitly wants the higher rail', () => {
      expect(
        assignBoardPin(stateWith(), board, dht, {
          peripheralPinId: 'VCC',
          preferredBoardPinId: 'VIN',
        }).boardPin,
      ).toBe('VIN');
    });

    it('refuses to choose a pin for a passive lead', () => {
      const led = { id: LED, definitionId: 'led', label: 'LED' };

      // Every board pin "satisfies" a passive lead, so an automatic choice would put
      // the anode and the cathode on the same rail.
      expect(() =>
        assignBoardPin(stateWith(), board, led, { peripheralPinId: 'A' }),
      ).toThrow(expect.objectContaining({ code: 'PIN_NEEDS_EXPLICIT_WIRING' }));
    });

    it('is deterministic: the same state yields the same pin', () => {
      const first = assignBoardPin(stateWith(), board, dht, {
        peripheralPinId: 'DATA',
      });
      const second = assignBoardPin(stateWith(), board, dht, {
        peripheralPinId: 'DATA',
      });

      expect(first.boardPin).toBe(second.boardPin);
    });

    it('reports a definition the platform cannot describe rather than guessing', () => {
      const state: CircuitState = {
        components: [
          { id: BOARD, definitionId: 'pico-w', label: 'Pico W' },
          { id: DHT, definitionId: 'dht22', label: 'DHT22' },
        ],
        connections: [],
      };

      expect(() =>
        assignBoardPin(
          state,
          { id: BOARD, definitionId: 'pico-w', label: 'Pico W' },
          dht,
          { peripheralPinId: 'DATA' },
        ),
      ).toThrow(expect.objectContaining({ code: 'DEFINITION_NOT_IN_CATALOG' }));
    });
  });

  describe('findBoard', () => {
    it('finds the development board among the placed parts', () => {
      expect(findBoard(stateWith())?.id).toBe(BOARD);
    });

    it('returns null when a project holds no board', () => {
      expect(
        findBoard({
          components: [{ id: DHT, definitionId: 'dht22', label: 'DHT22' }],
          connections: [],
        }),
      ).toBeNull();
    });
  });

  describe('pinoutOf', () => {
    it('reports which pins are taken and by what', () => {
      const state = stateWith([
        wire(
          'w1',
          { componentId: DHT, pinId: 'DATA' },
          { componentId: BOARD, pinId: 'GPIO4' },
        ),
      ]);

      const entries = pinoutOf(state, resolveComponent(state, BOARD));
      const gpio4 = entries.find((entry) => entry.pin === 'GPIO4');
      const gpio5 = entries.find((entry) => entry.pin === 'GPIO5');

      expect(gpio4?.connectedTo).toEqual(['DHT22:DATA']);
      expect(gpio4?.aliases).toEqual(['D4']);
      expect(gpio5?.connectedTo).toEqual([]);
    });
  });

  it('exposes refusals as WiringError so callers can map the code', () => {
    try {
      validateConnection(
        stateWith(),
        { componentId: DHT, pinId: 'DATA' },
        { componentId: BOARD, pinId: '3V3' },
      );
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(WiringError);
    }
  });

  describe('side of the board', () => {
    const board = {
      id: BOARD,
      definitionId: 'esp32-devkit-v1',
      label: 'ESP32',
    };
    const dht = { id: DHT, definitionId: 'dht22', label: 'DHT22' };

    it('puts a new part on the emptier header, and its ground beside it', () => {
      // The left header already carries a signal wire.
      const busyLeft = stateWith([
        wire(
          'w1',
          { componentId: LED, pinId: 'A' },
          { componentId: BOARD, pinId: 'GPIO32' },
        ),
      ]);
      const data = assignBoardPin(busyLeft, board, dht, {
        peripheralPinId: 'DATA',
      });
      expect(data.boardPin).toBe('GPIO23');

      const withData = stateWith([
        ...busyLeft.connections,
        wire(
          'w2',
          { componentId: DHT, pinId: 'DATA' },
          { componentId: BOARD, pinId: data.boardPin },
        ),
      ]);
      const ground = assignBoardPin(withData, board, dht, {
        peripheralPinId: 'GND',
      });
      expect(ground.boardPin).toBe('GND-R');
    });

    it('never moves an I2C line off the board own SDA to balance sides', () => {
      const oled = { id: OLED, definitionId: 'oled-096-i2c', label: 'OLED' };
      const busyRight = stateWith([
        wire(
          'w1',
          { componentId: LED, pinId: 'A' },
          { componentId: BOARD, pinId: 'GPIO23' },
        ),
      ]);
      expect(
        assignBoardPin(busyRight, board, oled, { peripheralPinId: 'SDA' })
          .boardPin,
      ).toBe('GPIO21');
    });
  });
});
