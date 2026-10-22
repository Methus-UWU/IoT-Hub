import { AiToolCall } from '../providers/ai-provider.interface';
import { ToolRefusal, userFacingWarnings } from './plan-warnings';
import { DraftFile, ProjectDraft } from './project-draft';

const BOARD = 'component-board';
const LED = 'component-led';
const RESISTOR = 'component-resistor';
const MAIN = 'main.ino';

function draft(): ProjectDraft {
  return new ProjectDraft(
    {
      components: [
        {
          id: BOARD,
          definitionId: 'esp32-devkit-v1',
          label: 'ESP32 DevKit V1',
        },
        { id: LED, definitionId: 'led', label: 'LED' },
        { id: RESISTOR, definitionId: 'resistor', label: 'R1' },
      ],
      connections: [],
    },
    new Map<string, DraftFile>([
      [MAIN, { content: 'void setup() {}\n', exists: true }],
    ]),
  );
}

function refusal(
  name: string,
  args: unknown,
  message = 'REFUSED',
): ToolRefusal {
  const call: AiToolCall = {
    id: `call-${name}`,
    name,
    rawArguments: JSON.stringify(args),
  };
  return { call, message };
}

/**
 * The bare-LED sequence, which is the one that produced the wall of red text: the model
 * asks the platform to assign a board pin for a passive lead, is told it cannot, and comes
 * back with the resistor circuit it should have built. The turn works; the user should not
 * be shown its false starts.
 */
describe('userFacingWarnings', () => {
  it('drops a refused assignment the model went on to wire itself', () => {
    const project = draft();
    const refused = refusal('wire_to_board', {
      componentId: LED,
      devicePin: 'A',
    });

    project.connect(
      { componentId: LED, pinId: 'A' },
      { componentId: RESISTOR, pinId: '1' },
    );
    project.connect(
      { componentId: RESISTOR, pinId: '2' },
      { componentId: BOARD, pinId: 'GPIO4' },
    );

    expect(userFacingWarnings([refused], project)).toEqual([]);
  });

  it('keeps a refusal that is still true of the finished draft', () => {
    const project = draft();
    const refused = refusal(
      'wire_to_board',
      { componentId: LED, devicePin: 'A' },
      'PIN_NEEDS_EXPLICIT_WIRING: LED:A is a passive lead',
    );

    const [warning] = userFacingWarnings([refused], project);

    expect(warning).toContain('wire_to_board: ');
    expect(warning).toContain('passive lead');
  });

  it('says nothing about a read the model could not make', () => {
    const project = draft();
    const refused = refusal('read_source_file', { path: 'nowhere.ino' });

    expect(userFacingWarnings([refused], project)).toEqual([]);
  });

  it('drops a refused write once the file was written', () => {
    const project = draft();
    const refused = refusal(
      'write_source_file',
      { path: MAIN },
      'Refused: this would cut',
    );

    project.writeFile(MAIN, 'void setup() {}\nvoid loop() {}\n');

    expect(userFacingWarnings([refused], project)).toEqual([]);
  });

  it('shows one line per distinct problem, and not more than five', () => {
    const project = draft();
    const repeated = Array.from({ length: 8 }, () =>
      refusal(
        'add_device',
        { definitionId: 'nothing' },
        'wirePins must contain 1 to 16',
      ),
    );
    const others = Array.from({ length: 6 }, (_, index) =>
      refusal(
        'add_device',
        { definitionId: `absent-${index}` },
        `problem ${index}`,
      ),
    );

    const deduped = userFacingWarnings(repeated, project);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toContain('wirePins must contain 1 to 16');

    expect(userFacingWarnings(others, project)).toHaveLength(5);
  });

  it('cuts a refusal down to its first line', () => {
    const project = draft();
    const refused = refusal(
      'add_device',
      { definitionId: 'absent' },
      'The headline.\nA paragraph the model needs and the user does not.',
    );

    expect(userFacingWarnings([refused], project)).toEqual([
      'add_device: The headline.',
    ]);
  });
});
