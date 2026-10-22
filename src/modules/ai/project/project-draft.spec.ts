import { CircuitState } from '../../projects/pin-assignment';
import { DraftFile, ProjectDraft, isPlaceholderRef } from './project-draft';

const BOARD = 'component-board';
const DHT = 'component-dht';

function draftWith(
  options: {
    components?: CircuitState['components'];
    connections?: CircuitState['connections'];
    files?: Record<string, string>;
  } = {},
): ProjectDraft {
  const files = new Map<string, DraftFile>(
    Object.entries(options.files ?? {}).map(([path, content]) => [
      path,
      { content, exists: true },
    ]),
  );

  return new ProjectDraft(
    {
      components: options.components ?? [
        {
          id: BOARD,
          definitionId: 'esp32-devkit-v1',
          label: 'ESP32 DevKit V1',
        },
        { id: DHT, definitionId: 'dht22', label: 'DHT22' },
      ],
      connections: options.connections ?? [],
    },
    files,
  );
}

describe('ProjectDraft', () => {
  describe('addDevice', () => {
    it('reuses a part the project already contains instead of duplicating it', () => {
      const draft = draftWith();

      const result = draft.addDevice('dht22');

      expect(result.created).toBe(false);
      expect(result.component.id).toBe(DHT);
      expect(draft.actions()).toEqual([]);
    });

    it('adds a second unit only when the caller asked for one', () => {
      const draft = draftWith();

      const result = draft.addDevice('dht22', { allowDuplicate: true });

      expect(result.created).toBe(true);
      expect(isPlaceholderRef(result.component.id)).toBe(true);
      expect(draft.actions()).toHaveLength(1);
    });

    it('refuses a definition that is not in the catalog', () => {
      expect(() => draftWith().addDevice('not-a-real-part')).toThrow(
        expect.objectContaining({ code: 'DEFINITION_NOT_IN_CATALOG' }),
      );
    });

    it('lets a newly staged part be wired in the same plan', () => {
      const draft = draftWith({
        components: [
          { id: BOARD, definitionId: 'esp32-devkit-v1', label: 'ESP32' },
        ],
      });

      const added = draft.addDevice('oled-096-i2c');
      const assignment = draft.wireToBoard(added.component.id, 'SDA');

      expect(assignment.boardPin).toBe('GPIO21');
      expect(draft.actions().map((action) => action.type)).toEqual([
        'add_device',
        'connect',
      ]);
    });
  });

  describe('wireToBoard', () => {
    it('assigns a legal pin and records the wire', () => {
      const draft = draftWith();

      const assignment = draft.wireToBoard(DHT, 'DATA');

      expect(assignment.reused).toBe(false);
      expect(assignment.boardPin).toMatch(/^GPIO\d+$/);
      expect(draft.actions()).toEqual([
        expect.objectContaining({
          type: 'connect',
          from: { componentId: DHT, pinId: 'DATA' },
          to: { componentId: BOARD, pinId: assignment.boardPin },
          kind: 'signal',
        }),
      ]);
    });

    it('reuses an existing wire and stages nothing', () => {
      const draft = draftWith({
        connections: [
          {
            id: 'wire-1',
            from: { componentId: DHT, pinId: 'DATA' },
            to: { componentId: BOARD, pinId: 'GPIO27' },
            kind: 'signal',
          },
        ],
      });

      const assignment = draft.wireToBoard(DHT, 'DATA');

      expect(assignment).toMatchObject({ boardPin: 'GPIO27', reused: true });
      expect(draft.isEmpty).toBe(true);
    });

    it('refuses to wire against a project with no board', () => {
      const draft = draftWith({
        components: [{ id: DHT, definitionId: 'dht22', label: 'DHT22' }],
      });

      expect(() => draft.wireToBoard(DHT, 'DATA')).toThrow(
        expect.objectContaining({ code: 'NO_BOARD_IN_PROJECT' }),
      );
    });

    it('does not reach a component outside the project', () => {
      expect(() =>
        draftWith().wireToBoard('component-elsewhere', 'DATA'),
      ).toThrow(expect.objectContaining({ code: 'COMPONENT_NOT_FOUND' }));
    });

    it('keeps two peripherals off the same signal pin', () => {
      const draft = draftWith({
        components: [
          { id: BOARD, definitionId: 'esp32-devkit-v1', label: 'ESP32' },
          { id: DHT, definitionId: 'dht22', label: 'DHT22' },
          { id: 'component-pir', definitionId: 'pir-hc-sr501', label: 'PIR' },
        ],
      });

      const first = draft.wireToBoard(DHT, 'DATA');
      const second = draft.wireToBoard('component-pir', 'OUT');

      expect(second.boardPin).not.toBe(first.boardPin);
    });

    it('shares the supply rail between peripherals', () => {
      const draft = draftWith({
        components: [
          { id: BOARD, definitionId: 'esp32-devkit-v1', label: 'ESP32' },
          { id: DHT, definitionId: 'dht22', label: 'DHT22' },
          { id: 'component-oled', definitionId: 'oled-096-i2c', label: 'OLED' },
        ],
      });

      const first = draft.wireToBoard(DHT, 'VCC');
      const second = draft.wireToBoard('component-oled', 'VCC');

      expect(first.boardPin).toBe(second.boardPin);
    });
  });

  describe('disconnect', () => {
    it('stages removal of a stored wire', () => {
      const draft = draftWith({
        connections: [
          {
            id: 'wire-1',
            from: { componentId: DHT, pinId: 'DATA' },
            to: { componentId: BOARD, pinId: 'GPIO4' },
            kind: 'signal',
          },
        ],
      });

      draft.disconnect(
        { componentId: BOARD, pinId: 'GPIO4' },
        { componentId: DHT, pinId: 'DATA' },
      );

      expect(draft.actions()).toEqual([
        expect.objectContaining({ type: 'disconnect', connectionId: 'wire-1' }),
      ]);
      expect(draft.state().connections).toHaveLength(0);
    });

    it('withdraws a wire the same plan created rather than scheduling a delete', () => {
      const draft = draftWith();
      const assignment = draft.wireToBoard(DHT, 'DATA');

      draft.disconnect(
        { componentId: DHT, pinId: 'DATA' },
        { componentId: BOARD, pinId: assignment.boardPin },
      );

      expect(draft.actions()).toEqual([]);
    });
  });

  describe('writeFile', () => {
    it('reads back what the plan would write, not what is stored', () => {
      const draft = draftWith({ files: { 'main.ino': 'void setup() {}' } });

      draft.writeFile('main.ino', 'void setup() { Serial.begin(115200); }');

      expect(draft.readFile('main.ino')?.content).toContain('Serial.begin');
    });

    it('collapses repeated writes to one action per file', () => {
      const draft = draftWith({ files: { 'main.ino': 'a' } });

      draft.writeFile('main.ino', 'b');
      draft.writeFile('main.ino', 'c');

      expect(draft.actions()).toEqual([
        expect.objectContaining({
          type: 'write_file',
          path: 'main.ino',
          content: 'c',
        }),
      ]);
    });

    it('marks a file the project does not have as a creation', () => {
      const draft = draftWith({ files: { 'main.ino': 'a' } });

      expect(draft.writeFile('sensors.h', '#pragma once')).toEqual({
        created: true,
      });
    });
  });

  it('starts with no proposal at all', () => {
    expect(draftWith().isEmpty).toBe(true);
  });
});
