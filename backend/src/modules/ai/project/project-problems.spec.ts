import { CircuitState } from '../../projects/pin-assignment';
import { ProjectDiagnosticsDto } from './dto/project-ai.dto';
import { DraftFile, ProjectDraft } from './project-draft';
import { auditCircuit, renderProblems } from './project-problems';

const BOARD = 'component-board';
const DHT = 'component-dht';
const PUMP = 'component-pump';
const SUPPLY = 'component-12v';

function circuit(overrides: Partial<CircuitState> = {}): CircuitState {
  return {
    components: [
      { id: BOARD, definitionId: 'esp32-devkit-v1', label: 'ESP32 DevKit V1' },
      { id: DHT, definitionId: 'dht22', label: 'DHT22' },
    ],
    connections: [],
    ...overrides,
  };
}

describe('auditCircuit', () => {
  it('reports a part with nothing wired to its supply pins', () => {
    const problems = auditCircuit(circuit());

    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'unpowered-part' }),
    );
    expect(
      problems.find((p) => p.code === 'unpowered-part')?.message,
    ).toContain('DHT22');
  });

  it('says nothing about the board itself, which is the supply', () => {
    const problems = auditCircuit({
      components: [
        { id: BOARD, definitionId: 'esp32-devkit-v1', label: 'ESP32' },
      ],
      connections: [],
    });

    expect(problems).toEqual([]);
  });

  it('reports a rail above what the part on the other end is rated for', () => {
    const problems = auditCircuit({
      components: [
        { id: PUMP, definitionId: 'water-pump', label: 'Pump' },
        { id: SUPPLY, definitionId: 'vcc-12v', label: 'VCC 12V' },
      ],
      connections: [
        {
          id: 'wire-1',
          from: { componentId: SUPPLY, pinId: 'VCC' },
          to: { componentId: PUMP, pinId: '+' },
          kind: 'power',
          color: '#ef4444',
        },
      ],
    });

    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'overvoltage', severity: 'warning' }),
    );
  });

  it('reports a stored wire that shorts a supply to ground', () => {
    const problems = auditCircuit(
      circuit({
        connections: [
          {
            id: 'wire-1',
            from: { componentId: BOARD, pinId: '3V3' },
            to: { componentId: BOARD, pinId: 'GND-L' },
            kind: 'power',
            color: '#ef4444',
          },
        ],
      }),
    );

    expect(problems).toContainEqual(
      expect.objectContaining({
        code: 'POWER_GROUND_SHORT',
        severity: 'error',
      }),
    );
  });

  it('does not report an existing wire as a duplicate of itself', () => {
    const problems = auditCircuit(
      circuit({
        connections: [
          {
            id: 'wire-1',
            from: { componentId: BOARD, pinId: 'GPIO4' },
            to: { componentId: DHT, pinId: 'DATA' },
            kind: 'signal',
            color: '#22c55e',
          },
        ],
      }),
    );

    expect(
      problems.some((problem) => problem.code === 'CONNECTION_ALREADY_EXISTS'),
    ).toBe(false);
  });

  /**
   * The circuit an assistant actually proposed: LED anode to GPIO25, and the same anode
   * to GPIO25 again through a 220 ohm resistor. Every wire is legal, the engine that
   * judges wires one at a time sees nothing, and the resistor limits nothing.
   */
  describe('a series resistor that was wired around', () => {
    const LED = 'component-led';
    const RESISTOR = 'component-resistor';

    function ledCircuit(
      connections: CircuitState['connections'],
    ): CircuitState {
      return {
        components: [
          {
            id: BOARD,
            definitionId: 'esp32-devkit-v1',
            label: 'ESP32 DevKit V1',
          },
          { id: LED, definitionId: 'led', label: 'Status LED' },
          { id: RESISTOR, definitionId: 'resistor', label: 'R1' },
        ],
        connections,
      };
    }

    it('reports the resistor as shorted out', () => {
      const problems = auditCircuit(
        ledCircuit([
          {
            id: 'w1',
            from: { componentId: LED, pinId: 'A' },
            to: { componentId: BOARD, pinId: 'GPIO25' },
            kind: 'signal',
          },
          {
            id: 'w2',
            from: { componentId: RESISTOR, pinId: '1' },
            to: { componentId: BOARD, pinId: 'GPIO25' },
            kind: 'signal',
          },
          {
            id: 'w3',
            from: { componentId: RESISTOR, pinId: '2' },
            to: { componentId: LED, pinId: 'A' },
            kind: 'signal',
          },
        ]),
      );

      const found = problems.find(
        (problem) => problem.code === 'bypassed-current-limiter',
      );
      expect(found?.severity).toBe('warning');
      expect(found?.message).toContain('R1');
      expect(found?.message).toContain('limits no current');
    });

    it('says nothing when the resistor is genuinely in series', () => {
      const problems = auditCircuit(
        ledCircuit([
          {
            id: 'w1',
            from: { componentId: BOARD, pinId: 'GPIO25' },
            to: { componentId: RESISTOR, pinId: '1' },
            kind: 'signal',
          },
          {
            id: 'w2',
            from: { componentId: RESISTOR, pinId: '2' },
            to: { componentId: LED, pinId: 'A' },
            kind: 'signal',
          },
          {
            id: 'w3',
            from: { componentId: LED, pinId: 'K' },
            to: { componentId: BOARD, pinId: 'GND-L' },
            kind: 'ground',
          },
        ]),
      );

      expect(
        problems.some((problem) => problem.code === 'bypassed-current-limiter'),
      ).toBe(false);
    });

    it('says nothing about a resistor with only one lead wired', () => {
      const problems = auditCircuit(
        ledCircuit([
          {
            id: 'w1',
            from: { componentId: BOARD, pinId: 'GPIO25' },
            to: { componentId: RESISTOR, pinId: '1' },
            kind: 'signal',
          },
        ]),
      );

      expect(
        problems.some((problem) => problem.code === 'bypassed-current-limiter'),
      ).toBe(false);
    });
  });
});

describe('renderProblems', () => {
  it('quotes what the client reported, apart from the server audit', () => {
    const diagnostics: ProjectDiagnosticsDto = {
      firmware: {
        phase: 'compile',
        line: 12,
        message: 'คาดว่าจะเจอ ";"',
        file: 'main.ino',
      },
      serial: ['moisture: 35%  pump: ON'],
      build: ['error: no such file'],
      buildState: 'error',
      wiring: [
        {
          severity: 'warning',
          code: 'split-supply',
          title: 'VCC กับ GND มาจากคนละแหล่งจ่าย',
          detail: 'relay VCC จากสัญลักษณ์ แต่ GND ของบอร์ด',
        },
      ],
    };

    const text = renderProblems(circuit(), diagnostics);

    expect(text).toContain('Wiring, checked on the server');
    expect(text).toContain("Reported by the user's browser");
    expect(text).toContain('line 12');
    expect(text).toContain('split-supply');
    expect(text).toContain('moisture: 35%  pump: ON');
    expect(text).toContain('error: no such file');
  });

  it('states plainly when the server found nothing wrong', () => {
    const text = renderProblems({
      components: [
        { id: BOARD, definitionId: 'esp32-devkit-v1', label: 'ESP32' },
      ],
      connections: [],
    });

    expect(text).toContain('no wiring problem found');
    expect(text).not.toContain("Reported by the user's browser");
  });
});

describe('ProjectDraft.problems', () => {
  it('counts wiring the assistant has just staged', () => {
    const draft = new ProjectDraft(
      circuit(),
      new Map<string, DraftFile>(),
      undefined,
    );

    expect(draft.problems()).toContain('unpowered-part');

    draft.wireToBoard(DHT, 'VCC');
    draft.wireToBoard(DHT, 'GND');

    expect(draft.problems()).not.toContain('unpowered-part');
  });
});
