import { findDevice } from '../../projects/catalog/device-catalog';
import {
  CircuitState,
  WiringError,
  bypassedCurrentLimiters,
  findBoard,
  validateConnection,
} from '../../projects/pin-assignment';
import { ProjectDiagnosticsDto } from './dto/project-ai.dto';

/**
 * What is wrong with this project right now.
 *
 * Two sources, and the difference between them matters enough to keep them apart in the
 * text the model reads. The **audit** is the server's own judgement of the stored circuit:
 * it re-runs the wiring rules over every wire that is already there, which nothing else
 * does — the rules normally only run when a new wire is staged, so a project wired by hand
 * before those rules existed is never re-examined. The **reported** half is what the user's
 * browser saw: compile and runtime faults from the simulator, its wiring findings, and the
 * tail of the serial monitor or a failed firmware build.
 *
 * The reported half is untrusted text. It is size-capped by the DTO, rendered as a quotation
 * of what the client said rather than as fact, and never used to decide anything — it exists
 * so the assistant can answer "why does my sensor read 0" without the user pasting the error.
 */

export interface ProjectProblem {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
}

/** Pins of these types are what a part needs before it can do anything at all. */
const SUPPLY_TYPES = ['vcc', 'gnd'] as const;

export function auditCircuit(state: CircuitState): readonly ProjectProblem[] {
  const labels = new Map(
    state.components.map((component) => [
      component.id,
      component.label || component.definitionId,
    ]),
  );
  const describe = (componentId: string, pinId: string) =>
    `${labels.get(componentId) ?? componentId}:${pinId}`;

  const problems: ProjectProblem[] = [];

  for (const connection of state.connections) {
    // The wire is judged against the circuit *without itself*, or the engine would report
    // every stored wire as a duplicate of the one being checked.
    const others: CircuitState = {
      ...state,
      connections: state.connections.filter(
        (candidate) => candidate.id !== connection.id,
      ),
    };
    const where = `${describe(connection.from.componentId, connection.from.pinId)} -> ${describe(
      connection.to.componentId,
      connection.to.pinId,
    )}`;

    try {
      const validated = validateConnection(
        others,
        connection.from,
        connection.to,
      );
      for (const warning of validated.warnings) {
        problems.push({
          severity: 'warning',
          code: warning.code,
          message: `${where}: ${warning.message}`,
        });
      }
    } catch (error) {
      problems.push({
        severity: 'error',
        code: error instanceof WiringError ? error.code : 'WIRE_INVALID',
        message: `${where}: ${
          error instanceof Error ? error.message : 'this wire is not valid'
        }`,
      });
    }
  }

  problems.push(...unpoweredParts(state, labels));
  problems.push(...bypassedLimiters(state, labels));
  return problems;
}

/**
 * Series resistors that ended up shorted.
 *
 * A whole-circuit property, so it is checked once here rather than per wire: no single
 * wire is wrong, and the engine that judges wires one at a time cannot see it. The shape
 * is always the same — the part is wired in series *and* jumped around, usually because
 * the anode was wired to the GPIO before the resistor was added and never unwired.
 */
function bypassedLimiters(
  state: CircuitState,
  labels: ReadonlyMap<string, string>,
): readonly ProjectProblem[] {
  return bypassedCurrentLimiters(state).map(({ component, pins }) => ({
    severity: 'warning' as const,
    code: 'bypassed-current-limiter',
    message: `${labels.get(component.id) ?? component.id} has ${pins[0]} and ${pins[1]} on the same node, so it is shorted out and limits no current — whatever it protects is driven as if it were not there. Remove the wire that goes around it.`,
  }));
}

/**
 * Parts with supply pins and nothing on them.
 *
 * This is the commonest reason a correctly written sketch reads nothing: the signal wire is
 * there and the power wire is not, so the module never runs and the pin just floats.
 */
function unpoweredParts(
  state: CircuitState,
  labels: ReadonlyMap<string, string>,
): readonly ProjectProblem[] {
  const board = findBoard(state);
  const wired = new Set(
    state.connections.flatMap((connection) => [
      `${connection.from.componentId}:${connection.from.pinId}`,
      `${connection.to.componentId}:${connection.to.pinId}`,
    ]),
  );

  const problems: ProjectProblem[] = [];
  for (const component of state.components) {
    if (component.id === board?.id) continue;
    const definition = findDevice(component.definitionId);
    // A supply sources power rather than needing it, and a part with no pinout cannot be
    // judged at all.
    if (!definition || definition.powerSource) continue;

    const missing = SUPPLY_TYPES.map((type) =>
      definition.pins.filter((pin) => pin.type === type),
    )
      .filter(
        (pins) =>
          pins.length &&
          pins.every((pin) => !wired.has(`${component.id}:${pin.name}`)),
      )
      .map((pins) => pins.map((pin) => pin.name).join(' or '));

    if (!missing.length) continue;
    problems.push({
      severity: 'warning',
      code: 'unpowered-part',
      message: `${labels.get(component.id) ?? component.id} has nothing wired to ${missing.join(
        ' and nothing wired to ',
      )}, so it has no power and cannot respond`,
    });
  }
  return problems;
}

/**
 * The problems block, as the model reads it.
 *
 * Kept in one place because the context prepended to the conversation and the
 * `get_project_problems` tool must not be able to disagree with each other.
 */
export function renderProblems(
  state: CircuitState,
  diagnostics?: ProjectDiagnosticsDto,
): string {
  const lines: string[] = ['# Problems in this project'];

  const audit = auditCircuit(state);
  lines.push('');
  lines.push('## Wiring, checked on the server against the stored circuit');
  if (!audit.length) {
    lines.push('- no wiring problem found');
  }
  for (const problem of audit) {
    lines.push(`- [${problem.severity}] ${problem.code}: ${problem.message}`);
  }

  const reported = renderReported(diagnostics);
  if (reported.length) {
    lines.push('');
    lines.push(
      "## Reported by the user's browser (simulator, serial monitor, firmware build)",
    );
    lines.push(...reported);
  }

  return lines.join('\n');
}

function renderReported(diagnostics?: ProjectDiagnosticsDto): string[] {
  if (!diagnostics) return [];
  const lines: string[] = [];

  const fault = diagnostics.firmware;
  if (fault) {
    lines.push(
      `- ${fault.phase === 'compile' ? 'The sketch does not compile' : 'The sketch stopped at runtime'}: ${
        fault.file ? `${fault.file} ` : ''
      }line ${fault.line} — ${fault.message}`,
    );
  }

  for (const finding of diagnostics.wiring ?? []) {
    lines.push(
      `- [${finding.severity}] ${finding.code}: ${finding.title} — ${finding.detail}`,
    );
  }

  if (diagnostics.buildState === 'error' && diagnostics.build?.length) {
    lines.push('- The last firmware build failed:');
    lines.push(...diagnostics.build.map((line) => `    ${line}`));
  }

  if (diagnostics.serial?.length) {
    lines.push('- Last serial output:');
    lines.push(...diagnostics.serial.map((line) => `    ${line}`));
  }

  return lines;
}
