import { AiToolCall } from '../providers/ai-provider.interface';
import { READ_TOOLS } from './ai-tools';
import { ProjectDraft } from './project-draft';

/**
 * Which of the platform's refusals are worth showing beside the accept button.
 *
 * A tool refusal is written for the model, and the model usually acts on it: told that a
 * bare LED's anode cannot be auto-assigned, it comes back with `connect_pins` and wires
 * the LED correctly. Forwarding every refusal to the user turned a turn that worked into a
 * page of red text describing steps that were retried and succeeded — the user reads it as
 * a broken proposal and hesitates over a plan that is, in fact, complete.
 *
 * So a refusal survives only if it is still true of the finished draft. "LED:A cannot be
 * auto-assigned" is dropped once LED:A is wired; it is kept if the LED ended up with
 * nothing on that pin, which is a real gap in what the user is about to accept. Read tools
 * never describe the plan at all, so their refusals are for the model alone.
 *
 * What this is not: the assignment engine's advisory warnings. Those describe a wire that
 * was made and belong in the plan on their own terms.
 */

/** Beyond a handful, a warning list stops being read at all. */
const MAX_WARNINGS = 5;
/** How much of a refusal fits beside the accept button. */
const MAX_WARNING_CHARS = 200;

export interface ToolRefusal {
  readonly call: AiToolCall;
  readonly message: string;
}

const READ_TOOL_NAMES = new Set(READ_TOOLS.map((tool) => tool.name));

export function userFacingWarnings(
  refusals: readonly ToolRefusal[],
  draft: ProjectDraft,
): string[] {
  const unresolved = refusals.filter(
    (refusal) =>
      !READ_TOOL_NAMES.has(refusal.call.name) &&
      !isResolved(refusal.call, draft),
  );

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const refusal of unresolved) {
    const line = summarise(refusal);
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length === MAX_WARNINGS) break;
  }
  return lines;
}

/** Whether the finished draft already does what the refused call was trying to do. */
function isResolved(call: AiToolCall, draft: ProjectDraft): boolean {
  const args = parseArguments(call.rawArguments);
  if (!args) return false;

  switch (call.name) {
    case 'add_device':
      return draft
        .state()
        .components.some(
          (component) => component.definitionId === text(args['definitionId']),
        );

    case 'wire_to_board':
      return isPinWired(
        draft,
        text(args['componentId']),
        text(args['devicePin']),
      );

    // A refused wire between two parts is answered either way round, and either end
    // having been wired to something else is still the model having solved it.
    case 'connect_pins':
      return (
        isPinWired(
          draft,
          text(args['fromComponentId']),
          text(args['fromPin']),
        ) && isPinWired(draft, text(args['toComponentId']), text(args['toPin']))
      );

    case 'disconnect_pins':
      return !(
        isPinWired(
          draft,
          text(args['fromComponentId']),
          text(args['fromPin']),
        ) && isPinWired(draft, text(args['toComponentId']), text(args['toPin']))
      );

    case 'write_source_file':
      return draft
        .actions()
        .some(
          (action) =>
            action.type === 'write_file' && action.path === text(args['path']),
        );

    default:
      return false;
  }
}

function isPinWired(
  draft: ProjectDraft,
  componentId: string | null,
  pinId: string | null,
): boolean {
  if (!componentId || !pinId) return false;
  const wanted = pinId.toUpperCase();
  return draft
    .state()
    .connections.some((connection) =>
      [connection.from, connection.to].some(
        (endpoint) =>
          endpoint.componentId === componentId &&
          endpoint.pinId.toUpperCase() === wanted,
      ),
    );
}

/**
 * One line, capped.
 *
 * A refusal is written at length for the model, which reads the whole tool result. The
 * user is reading a list beside a button, so the first line is what survives.
 */
function summarise(refusal: ToolRefusal): string {
  const firstLine = refusal.message.split('\n')[0].trim();
  const body =
    firstLine.length > MAX_WARNING_CHARS
      ? `${firstLine.slice(0, MAX_WARNING_CHARS).trimEnd()}…`
      : firstLine;
  return `${refusal.call.name}: ${body}`;
}

function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
