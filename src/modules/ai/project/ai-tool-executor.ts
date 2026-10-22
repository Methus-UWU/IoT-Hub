import {
  describeLibrary,
  describeSetting,
  libraryFor,
  findDevice,
  resolveSettings,
  searchDevices,
  settingsFromLabel,
} from '../../projects/catalog/device-catalog';
import {
  datasheetOf,
  hasDatasheet,
} from '../../projects/catalog/device-datasheets';
import {
  WiringError,
  pinoutOf,
  resolveComponent,
} from '../../projects/pin-assignment';
import { normalizeProjectFilePath } from '../../projects/project-file-path';
import { AiToolCall } from '../providers/ai-provider.interface';
import { isWriteTool } from './ai-tools';
import { DashboardDraftError } from './dashboard-draft';
import { describeOnboardLed } from './onboard-led';
import { ProjectDraft } from './project-draft';

/**
 * Runs one tool call against a draft.
 *
 * Everything arriving here is untrusted: the arguments are text a language model produced,
 * and they are parsed, type-checked, and resolved against the project before anything acts
 * on them. A component id that is not in this project fails the same way a misspelled pin
 * does — with a message the model can read and correct — rather than reaching a repository.
 *
 * A failed tool call is a *result*, not an exception. Telling the model "GPIO21 is already
 * wired to the OLED" is how it picks a different pin; throwing would end the turn and leave
 * the user with nothing.
 */

export interface ToolOutcome {
  /** Fed back to the model as the tool result. */
  readonly content: string;
  /** False when the call was refused. Used only to cap repeated failures. */
  readonly ok: boolean;
  readonly device?: {
    readonly componentId: string;
    readonly created: boolean;
    readonly wiringIncomplete: boolean;
  };
}

const MAX_CATALOG_RESULTS = 8;
const MAX_FILE_CHARS = 24_000;
/**
 * The pack averages 2,200 characters per document and its longest is 3,815, so this is
 * headroom for a document yet to be written rather than a limit anything hits today.
 */
const MAX_DATASHEET_CHARS = 12_000;

export function executeToolCall(
  draft: ProjectDraft,
  call: AiToolCall,
): ToolOutcome {
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(call.rawArguments);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return refuse('Arguments must be a JSON object.');
    }
    args = parsed as Record<string, unknown>;
  } catch {
    return refuse('Arguments were not valid JSON. Send a JSON object.');
  }

  try {
    switch (call.name) {
      case 'get_board_pinout':
        return boardPinout(draft);
      case 'get_device_pinout':
        return devicePinout(draft, args);
      case 'read_source_file':
        return readFile(draft, args);
      case 'get_project_problems':
        return ok(draft.problems());
      case 'search_device_catalog':
        return searchCatalog(args);
      case 'read_device_datasheet':
        return readDatasheet(draft, args);
      case 'add_device':
        return addDevice(draft, args);
      case 'configure_device':
        return configureDevice(draft, args);
      case 'wire_to_board':
        return wireToBoard(draft, args);
      case 'connect_pins':
        return connectPins(draft, args);
      case 'disconnect_pins':
        return disconnectPins(draft, args);
      case 'write_source_file':
        return writeFile(draft, args);
      case 'read_dashboard':
      case 'define_datastream':
      case 'place_widget':
      case 'update_widget':
      case 'remove_widget':
      case 'arrange_dashboard':
        return dashboardTool(draft, call.name, args);
      default:
        return refuse(`Unknown tool "${call.name}".`);
    }
  } catch (error) {
    if (error instanceof WiringError) {
      return refuse(`${error.code}: ${error.message}`);
    }
    if (error instanceof DashboardDraftError) return refuse(error.message);
    // A BadRequestException from the path normaliser, or anything else a tool raised.
    // Its message is safe to relay — none of these carry internals.
    return refuse(messageOf(error));
  }
}

export function isWriteToolCall(call: AiToolCall): boolean {
  return isWriteTool(call.name);
}

// ------------------------------------------------------------------ read tools

function boardPinout(draft: ProjectDraft): ToolOutcome {
  const board = draft.board();
  if (!board) {
    return refuse(
      'This project has no development board on the canvas, so there is no pinout and nothing can be wired. Tell the user a board must be added first.',
    );
  }

  const entries = pinoutOf(draft.state(), board);
  const lines = entries.map((entry) => {
    const aliases = entry.aliases.length
      ? ` (${entry.aliases.join(', ')})`
      : '';
    const used = entry.connectedTo.length
      ? `IN USE by ${entry.connectedTo.join(', ')}`
      : 'free';
    return `${entry.pin}${aliases} · ${entry.type} · ${entry.direction} · ${used}${
      entry.description ? ` · ${entry.description}` : ''
    }`;
  });

  const onboardLed = describeOnboardLed(board.definitionId);
  return ok(
    [
      `Board: ${board.label} (component id ${board.id})`,
      ...(onboardLed ? [onboardLed] : []),
      ...lines,
    ].join('\n'),
  );
}

function devicePinout(
  draft: ProjectDraft,
  args: Record<string, unknown>,
): ToolOutcome {
  const componentId = requireString(args, 'componentId');
  const component = resolveComponent(draft.state(), componentId);
  const entries = pinoutOf(draft.state(), component);

  const lines = entries.map((entry) => {
    const used = entry.connectedTo.length
      ? `wired to ${entry.connectedTo.join(', ')}`
      : 'free';
    return `${entry.pin} · ${entry.type} · ${entry.direction} · ${used}${
      entry.description ? ` · ${entry.description}` : ''
    }`;
  });

  return ok(
    [
      `${component.label} (${component.definitionId})`,
      ...lines,
      ...settingsLines(component.definitionId),
      ...libraryLines(component.definitionId),
    ].join('\n'),
  );
}

/**
 * The library the simulator runs for this part, with the calls to make. Code written
 * against it runs on the canvas; another library for the same part would not.
 */
function libraryLines(definitionId: string): string[] {
  const library = libraryFor(definitionId);
  return library ? [describeLibrary(library)] : [];
}

/** The part's configurable settings, as a pinout or search result lists them. */
function settingsLines(definitionId: string): string[] {
  const settings = findDevice(definitionId)?.settings ?? [];
  return settings.length
    ? [`settings: ${settings.map(describeSetting).join('; ')}`]
    : [];
}

function readFile(
  draft: ProjectDraft,
  args: Record<string, unknown>,
): ToolOutcome {
  const path = normalizeProjectFilePath(requireString(args, 'path'));
  const file = draft.readFile(path);

  if (!file) {
    return refuse(
      `No file "${path}" in this project. Files present: ${draft.fileNames().join(', ') || 'none'}`,
    );
  }

  if (file.content.length > MAX_FILE_CHARS) {
    return ok(
      `${file.content.slice(0, MAX_FILE_CHARS)}\n\n[truncated at ${MAX_FILE_CHARS} characters — the file is ${file.content.length} characters long. Do not rewrite it wholesale from this excerpt.]`,
    );
  }

  return ok(file.content || '[the file is empty]');
}

function searchCatalog(args: Record<string, unknown>): ToolOutcome {
  const query = requireString(args, 'query');
  const matches = searchDevices(query).slice(0, MAX_CATALOG_RESULTS);

  if (!matches.length) {
    return ok(`No catalog part matches "${query}".`);
  }

  return ok(
    matches
      .map(
        (device) =>
          `${device.id} · ${device.name} (${device.model}) · ${device.category} · interfaces: ${
            device.interfaces.join(', ') || 'none'
          } · pins: ${device.pins.map((pin) => pin.name).join(' ')}${
            device.settings?.length
              ? ` · settings: ${device.settings.map(describeSetting).join('; ')}`
              : ''
          }${libraryFor(device.id) ? ` · library: ${libraryFor(device.id)?.name}` : ''}${
            hasDatasheet(device.id) ? ' · datasheet' : ''
          }`,
      )
      .join('\n'),
  );
}

/**
 * The platform's own document for a part.
 *
 * Returned whole rather than summarised. These are written for someone building the
 * circuit, so the requirement that decides whether it works — the pull-up, the active-low
 * input, the leg that is not connected — is as likely to be in a footnote as in the wiring
 * section, and choosing which paragraphs matter is the model's job, not this function's.
 */
function readDatasheet(
  draft: ProjectDraft,
  args: Record<string, unknown>,
): ToolOutcome {
  const definitionId = requireString(args, 'definitionId');
  const device = findDevice(definitionId);
  if (!device) {
    const suggestions = searchDevices(definitionId)
      .slice(0, 5)
      .map((match) => match.id);
    return refuse(
      `"${definitionId}" is not in the device catalog.${
        suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''
      }`,
    );
  }

  const markdown = datasheetOf(definitionId);
  // Mark the review only after resolving a real catalog id. A missing long-form
  // document still counts as reviewed: the model explicitly learned that it must
  // fall back to the catalog pinout and interface rules instead of inventing facts.
  draft.markDatasheetReviewed(definitionId);
  if (!markdown) {
    return ok(
      `No datasheet is written for ${device.name} (${definitionId}) yet. Work from its pinout and the general rules for its interfaces, and say in your answer that you did.`,
    );
  }

  const body =
    markdown.length > MAX_DATASHEET_CHARS
      ? `${markdown.slice(0, MAX_DATASHEET_CHARS)}\n\n[truncated at ${MAX_DATASHEET_CHARS} characters]`
      : markdown;
  return ok(
    [
      `Datasheet — ${device.name} (${device.model}, ${definitionId})\n\n${body}`,
      ...libraryLines(definitionId),
    ].join('\n\n'),
  );
}

// ----------------------------------------------------------------- write tools

function configureDevice(
  draft: ProjectDraft,
  args: Record<string, unknown>,
): ToolOutcome {
  const component = resolveComponent(
    draft.state(),
    requireString(args, 'componentId'),
  );
  const settings = resolveSettings(component.definitionId, args['settings']);
  if (!settings.ok) return refuse(settings.reason);
  if (!Object.keys(settings.settings).length) {
    return refuse('settings must name at least one setting.');
  }

  draft.configure(component.id, settings.settings);
  return ok(
    `Staged ${component.label}: ${Object.entries(settings.settings)
      .map(([id, value]) => `${id} = ${String(value)}`)
      .join(', ')}.`,
  );
}

function addDevice(
  draft: ProjectDraft,
  args: Record<string, unknown>,
): ToolOutcome {
  const definitionId = requireString(args, 'definitionId');
  const label = optionalString(args, 'label');
  const allowDuplicate = args['allowDuplicate'] === true;
  const wirePins = args['wirePins'];
  if (
    wirePins !== undefined &&
    (!Array.isArray(wirePins) ||
      wirePins.length < 1 ||
      wirePins.length > 16 ||
      wirePins.some((pin: unknown) => typeof pin !== 'string' || !pin.trim()) ||
      new Set(wirePins).size !== wirePins.length)
  ) {
    return refuse('wirePins must contain 1 to 16 unique, non-empty pin names.');
  }

  // "RGB light" means one tri-colour part. Built from three single-colour LEDs it
  // is a different circuit, three times the wiring, and not what the user asked for.
  if (definitionId === 'led' && label && /\brgb\b/i.test(label)) {
    return refuse(
      'An RGB LED is one part, not three LEDs. Add rgb-led-common-cathode (or rgb-led-common-anode) once: its R, G and B legs each go to a PWM pin through their own resistor, and its common leg to GND (cathode) or 3V3 (anode).',
    );
  }

  if (!findDevice(definitionId)) {
    const suggestions = searchDevices(definitionId)
      .slice(0, 5)
      .map((device) => device.id);
    return refuse(
      `"${definitionId}" is not in the device catalog.${
        suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''
      }`,
    );
  }

  const datasheetGate = requireDatasheetReview(draft, [definitionId]);
  if (datasheetGate) return datasheetGate;

  const requested = resolveSettings(definitionId, args['settings']);
  if (!requested.ok) return refuse(requested.reason);
  const fromLabel = label ? settingsFromLabel(definitionId, label) : {};
  const settings = {
    ok: true as const,
    settings: { ...requested.settings, ...fromLabel },
  };

  const result = draft.addDevice(definitionId, {
    ...(label ? { label } : {}),
    allowDuplicate,
    settings: settings.settings,
  });
  // A reused part keeps its own add; its new values become a configure instead.
  if (!result.created && Object.keys(settings.settings).length) {
    draft.configure(result.component.id, settings.settings);
  }

  const summary = result.created
    ? `Staged adding ${result.component.label}. Its component id is ${result.component.id}; use that id to wire it.${settingsSummary(settings.settings)}`
    : `The draft already contains ${result.component.label} (component id ${result.component.id}). Reusing it — nothing was added. Use this id to wire remaining pins; another separate unit needs a distinct label and allowDuplicate: true.`;
  // Reuse the same validated assignment path as individual calls. A refusal names
  // the failed pin and retains explicit results for wires already staged.
  const wiring = ((wirePins ?? []) as string[]).map((devicePin) =>
    executeToolCall(draft, {
      id: 'add-device-wiring',
      name: 'wire_to_board',
      rawArguments: JSON.stringify({
        componentId: result.component.id,
        devicePin,
      }),
    }),
  );
  return {
    // The device is what this call stages, and it was staged. A pin that could not be
    // wired is reported in the content, which is where the model reads it and retries;
    // calling the whole thing refused put a successful add into the user's plan
    // warnings, where it reads as a failure of a change that in fact went through.
    ok: true,
    device: {
      componentId: result.component.id,
      created: result.created,
      wiringIncomplete: wiring.some((outcome) => !outcome.ok),
    },
    content: [
      summary,
      ...wiring.map(
        (outcome, index) =>
          `${(wirePins as string[])[index]}: ${outcome.ok ? '' : 'REFUSED: '}${outcome.content}`,
      ),
      devicePinout(draft, { componentId: result.component.id }).content,
    ].join('\n'),
  };
}

function wireToBoard(
  draft: ProjectDraft,
  args: Record<string, unknown>,
): ToolOutcome {
  const componentId = requireString(args, 'componentId');
  const devicePin = requireString(args, 'devicePin');
  const preferred = optionalString(args, 'preferredBoardPin');

  const component = resolveComponent(draft.state(), componentId);
  const datasheetGate = requireDatasheetReview(draft, [component.definitionId]);
  if (datasheetGate) return datasheetGate;

  const assignment = draft.wireToBoard(componentId, devicePin, preferred);
  const unsafe = unsafeWiringWarning(assignment.warnings);
  if (unsafe) {
    draft.disconnect(
      { componentId, pinId: assignment.peripheralPin },
      {
        componentId: draft.board()?.id ?? '',
        pinId: assignment.boardPin,
      },
    );
    return refuse(`UNSAFE_CONNECTION: ${unsafe.message}`);
  }
  const gpio = gpioNumberOf(assignment.boardPin);

  return ok(
    [
      assignment.reused
        ? `${draft.labelOf(componentId)}:${assignment.peripheralPin} is already wired to board pin ${assignment.boardPin}. Reusing it.`
        : `Staged: ${draft.labelOf(componentId)}:${assignment.peripheralPin} -> board ${assignment.boardPin}.`,
      gpio === null
        ? `Use board pin ${assignment.boardPin} in your code.`
        : `Use ${gpio} as the pin number in your code.`,
      ...assignment.warnings.map((warning) => `Warning: ${warning.message}`),
    ].join(' '),
  );
}

function connectPins(
  draft: ProjectDraft,
  args: Record<string, unknown>,
): ToolOutcome {
  const from = {
    componentId: requireString(args, 'fromComponentId'),
    pinId: requireString(args, 'fromPin'),
  };
  const to = {
    componentId: requireString(args, 'toComponentId'),
    pinId: requireString(args, 'toPin'),
  };
  const state = draft.state();
  const fromComponent = resolveComponent(state, from.componentId);
  const toComponent = resolveComponent(state, to.componentId);
  const boardId = draft.board()?.id;
  const datasheetGate = requireDatasheetReview(
    draft,
    [fromComponent, toComponent]
      .filter((component) => component.id !== boardId)
      .map((component) => component.definitionId),
  );
  if (datasheetGate) return datasheetGate;

  const result = draft.connect(from, to);
  const unsafe = unsafeWiringWarning(result.warnings);
  if (unsafe) {
    if (result.created) draft.disconnect(result.from, result.to);
    return refuse(`UNSAFE_CONNECTION: ${unsafe.message}`);
  }

  const description = `${draft.describe(result.from)} -> ${draft.describe(result.to)}`;
  return ok(
    [
      result.created
        ? `Staged wire ${description}.`
        : `${description} is already wired. Nothing added.`,
      ...result.warnings.map((warning) => `Warning: ${warning.message}`),
    ].join(' '),
  );
}

function disconnectPins(
  draft: ProjectDraft,
  args: Record<string, unknown>,
): ToolOutcome {
  draft.disconnect(
    {
      componentId: requireString(args, 'fromComponentId'),
      pinId: requireString(args, 'fromPin'),
    },
    {
      componentId: requireString(args, 'toComponentId'),
      pinId: requireString(args, 'toPin'),
    },
  );

  return ok('Staged removing that wire.');
}

function writeFile(
  draft: ProjectDraft,
  args: Record<string, unknown>,
): ToolOutcome {
  const path = normalizeProjectFilePath(requireString(args, 'path'));
  const content = requireString(args, 'content', { allowEmpty: true });

  const existing = draft.readFile(path);
  // A rewrite that loses most of a file is the failure mode this whole feature is meant
  // to avoid, so it is refused rather than merely noted. The model can retry with the
  // original text plus its change, which is what it should have sent.
  //
  // The floor is only there to let a stub be replaced without argument: a new project's
  // `src/main.cpp` is an empty setup/loop pair of under a hundred characters, and
  // challenging a rewrite of that would be noise. Two hundred characters is comfortably above a stub
  // and below any sketch that has real logic in it — a working Wi-Fi sketch is several
  // hundred, and replacing one of those wholesale is exactly what must be caught.
  if (
    existing &&
    existing.content.length > 200 &&
    content.length < existing.content.length * 0.5
  ) {
    return refuse(
      `Refused: this would cut ${path} from ${existing.content.length} to ${content.length} characters. Read the file and return it complete with your change applied, keeping the existing code.`,
    );
  }

  const result = draft.writeFile(path, content);
  return ok(
    result.created
      ? `Staged creating ${path}.`
      : `Staged an update to ${path}.`,
  );
}

// ---------------------------------------------------------------------- helpers

/**
 * Dashboard reads and staged changes. A change that moves things restates the dashboard,
 * so the next call is made against what is staged rather than what the model remembers.
 */
function dashboardTool(
  draft: ProjectDraft,
  name: string,
  args: Record<string, unknown>,
): ToolOutcome {
  const dashboard = draft.dashboard();
  if (!dashboard) {
    return refuse(
      'The dashboard could not be loaded this turn. Tell the user to retry.',
    );
  }
  switch (name) {
    case 'read_dashboard':
      return ok(dashboard.describe());
    case 'define_datastream': {
      const stream = dashboard.defineDatastream({
        key: args['key'],
        name: args['name'],
        dataType: args['dataType'],
        unit: args['unit'],
        min: args['min'],
        max: args['max'],
        source: args['source'],
        componentId: args['componentId'],
      });
      return ok(
        `Staged datastream ${stream.key}. Bind widgets to "${stream.key}" and use that key in the sketch.`,
      );
    }
    case 'place_widget': {
      const widget = dashboard.placeWidget({
        type: args['type'],
        title: args['title'],
        datastream: args['datastream'],
        cols: args['cols'],
        rows: args['rows'],
        unit: args['unit'],
        decimals: args['decimals'],
      });
      const layout = widget.layouts.desktop;
      return ok(
        `Staged ${widget.type} ${widget.id} at x${layout.x} y${layout.y} ${layout.cols}x${layout.rows}.`,
      );
    }
    case 'update_widget': {
      const widget = dashboard.updateWidget({
        id: args['id'],
        title: args['title'],
        datastream: args['datastream'],
        x: args['x'],
        y: args['y'],
        cols: args['cols'],
        rows: args['rows'],
      });
      return ok(`Staged update to ${widget.id}.\n\n${dashboard.describe()}`);
    }
    case 'remove_widget':
      dashboard.removeWidget(args['id']);
      return ok(`Staged removal.\n\n${dashboard.describe()}`);
    default:
      dashboard.arrange();
      return ok(`Staged arrangement.\n\n${dashboard.describe()}`);
  }
}

function ok(content: string): ToolOutcome {
  return { content, ok: true };
}

function refuse(content: string): ToolOutcome {
  return { content, ok: false };
}

/**
 * The model may ignore prose in a system prompt. Wiring therefore cannot proceed until
 * the executor has evidence that the relevant catalog datasheet was actually returned.
 */
function requireDatasheetReview(
  draft: ProjectDraft,
  definitionIds: readonly string[],
): ToolOutcome | null {
  const missing = [
    ...new Set(
      definitionIds.filter(
        (definitionId) =>
          hasDatasheet(definitionId) &&
          !draft.hasReviewedDatasheet(definitionId),
      ),
    ),
  ];
  if (!missing.length) return null;

  return refuse(
    `DATASHEET_REQUIRED: Before adding or wiring ${missing.join(', ')}, call read_device_datasheet for ${missing.join(
      ', ',
    )}. Follow its voltage, support-component, bus, polarity, and library requirements, then retry this call.`,
  );
}

/** AI-generated plans must not stage wiring the validator already knows is unsafe. */
function unsafeWiringWarning(
  warnings: readonly { code: string; message: string }[],
): { code: string; message: string } | undefined {
  return warnings.find((warning) =>
    ['overvoltage', 'undervoltage', 'output-conflict'].includes(warning.code),
  );
}

function requireString(
  args: Record<string, unknown>,
  key: string,
  options: { allowEmpty?: boolean } = {},
): string {
  const value = args[key];
  if (typeof value !== 'string' || (!options.allowEmpty && !value.trim())) {
    throw new Error(`"${key}" is required and must be a non-empty string.`);
  }
  return options.allowEmpty ? value : value.trim();
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * What a sketch writes for a board pin.
 *
 * `GPIO4` on an ESP32 is the number `4`; an Uno names its digital pins `4` already; an
 * analog pin is the macro `A0` and stays a name. Anything with no plain number — `3V3`,
 * `EN` — returns null, and the caller says "use pin X" rather than inventing an integer.
 */
function gpioNumberOf(boardPin: string): number | null {
  const match = /^(?:GPIO|IO|D)?(\d+)$/i.exec(boardPin);
  return match ? Number(match[1]) : null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  const response = (error as { response?: { message?: string } })?.response;
  return response?.message ?? 'The request could not be completed.';
}

/** The settings a part was staged with, stated so the code the model writes agrees. */
function settingsSummary(
  settings: Readonly<Record<string, string | number | boolean>>,
): string {
  const entries = Object.entries(settings);
  return entries.length
    ? ` Settings: ${entries.map(([id, value]) => `${id} = ${String(value)}`).join(', ')}.`
    : '';
}
