import { AiToolDefinition } from '../providers/ai-provider.interface';

/**
 * The tools the assistant may use inside a project.
 *
 * They are split on one line: reading answers a question about the project as it is now,
 * writing stages a change the user has yet to approve. Nothing here writes to the
 * database — a write tool records an intention on a draft, and the draft is returned as a
 * plan. That split is what lets the model see the pin a sensor was assigned, and write
 * code against that exact pin, without anything having been committed.
 *
 * Two things are deliberately absent. There is no tool that takes a workspace or project
 * id: the project is fixed by the route, so a model cannot reach another one by naming it.
 * And there is no tool that names a database row directly — wires are addressed by the two
 * pins they join, so a hallucinated id cannot delete a real wire.
 */

const COMPONENT_ID = {
  type: 'string',
  description:
    'Component id from the project context, or a value returned by add_device. Never invent one.',
} as const;

export const READ_TOOLS: readonly AiToolDefinition[] = [
  {
    name: 'get_board_pinout',
    description:
      "Every pin of this project's development board, with its type, capabilities, and what is currently wired to it. Use this before choosing any GPIO number.",
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_device_pinout',
    description:
      'Every pin of one component already in this project, with what is wired to each.',
    parameters: {
      type: 'object',
      properties: { componentId: COMPONENT_ID },
      required: ['componentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_source_file',
    description:
      'The current contents of one project source file. Read a file before modifying it; never rewrite a file you have not read.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Project-relative path, e.g. src/main.ino',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_dashboard',
    description:
      "The project's dashboard: its datastreams (the values widgets bind to, and the part each comes from) and its widgets with their bindings and grid positions. Read it before changing the dashboard.",
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_project_problems',
    description:
      "Problems in this project right now: the server's audit of every existing wire, parts left without power or ground, and whatever the user's IDE reported — compile or runtime errors from the simulator, its wiring findings, failed firmware builds, and the last serial output. Read this before answering why something does not work.",
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'search_device_catalog',
    description:
      'Search the platform device catalog by name, model, or purpose. Use it to find the definitionId of a part the user asked to ADD. It does not tell you what this project contains. A result marked "datasheet" has one you can read with read_device_datasheet.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'e.g. "temperature", "oled", "relay"',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_device_datasheet',
    description:
      "The platform's datasheet for one catalog part: how it is normally wired, the support components it needs, its operating limits, worked example code, and the mistakes that make it read nothing. Read it before wiring or writing code for a part you have not used in this project — it carries requirements no pinout shows, such as a mandatory pull-up or an active-low input.",
    parameters: {
      type: 'object',
      properties: {
        definitionId: {
          type: 'string',
          description:
            'Catalog id, e.g. dht22, relay2. Not a component id from this project.',
        },
      },
      required: ['definitionId'],
      additionalProperties: false,
    },
  },
];

export const WRITE_TOOLS: readonly AiToolDefinition[] = [
  {
    name: 'add_device',
    description:
      'Stage adding a component to the project after read_device_datasheet has been called for its definition in this turn. If the project already contains one of this definition it is reused and nothing is added, unless the user explicitly asked for an additional unit. Only call this when the user asked for hardware the project does not have.',
    parameters: {
      type: 'object',
      properties: {
        definitionId: {
          type: 'string',
          description:
            'Catalog id, e.g. dht22, oled-096-i2c. Confirm it with search_device_catalog first.',
        },
        label: {
          type: 'string',
          description:
            'Optional name shown on the canvas. Give separate units distinct labels, e.g. RGB LED 1 and RGB LED 2. Retrying the same definition and label reuses that unit, including when allowDuplicate is true.',
        },
        settings: {
          type: 'object',
          additionalProperties: { type: ['string', 'number', 'boolean'] },
          description:
            'Optional part settings by id, e.g. {"color": "green"} for an LED or {"trigger": "high"} for a relay. The allowed ids and values are listed under "settings" in search_device_catalog and the pinout. Set them whenever the request names one — a green status LED is an LED with color green.',
        },
        allowDuplicate: {
          type: 'boolean',
          description:
            'True only when the user asked for an ADDITIONAL unit of a part the project already has.',
        },
        wirePins: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 16,
          // `uniqueItems` is not accepted by every OpenRouter provider — one that rejects
          // it fails the whole request, not just this tool — so uniqueness is stated here
          // and enforced in `ai-tool-executor.ts` instead of being declared in the schema.
          description:
            'Optional component pin names confirmed by search_device_catalog, e.g. ["DATA", "VCC", "GND"]. Each name may appear only once. Add/reuse and wire these to legal board pins in one call. The result includes the pinout and assigned GPIO numbers. For bare LEDs/resistors use connect_pins instead.',
        },
      },
      required: ['definitionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'configure_device',
    description:
      'Stage new settings on a part already in the project, e.g. change an LED to green. For a part you are adding, pass settings to add_device instead.',
    parameters: {
      type: 'object',
      properties: {
        componentId: COMPONENT_ID,
        settings: {
          type: 'object',
          additionalProperties: { type: ['string', 'number', 'boolean'] },
          description:
            'Optional part settings by id, e.g. {"color": "green"} for an LED or {"trigger": "high"} for a relay. The allowed ids and values are listed under "settings" in search_device_catalog and the pinout. Set them whenever the request names one — a green status LED is an LED with color green.',
        },
      },
      required: ['componentId', 'settings'],
      additionalProperties: false,
    },
  },
  {
    name: 'wire_to_board',
    description:
      "Stage wiring one pin of a component to the board after reading that component definition's datasheet in this turn, letting the platform choose a legal pin. This is the normal way to wire something. The reply tells you the exact board pin assigned — write your code against that pin and no other. If the pin is already wired it is reused and no new wire is created.",
    parameters: {
      type: 'object',
      properties: {
        componentId: COMPONENT_ID,
        devicePin: {
          type: 'string',
          description: 'Pin name on the component, e.g. DATA, VCC, GND, SDA.',
        },
        preferredBoardPin: {
          type: 'string',
          description:
            'Optional board pin to try first, e.g. GPIO4. Refused if it is taken or cannot serve this signal.',
        },
      },
      required: ['componentId', 'devicePin'],
      additionalProperties: false,
    },
  },
  {
    name: 'connect_pins',
    description:
      'Stage a wire between two specific pins of two components after reading the datasheet for each documented non-board part in this turn. Prefer wire_to_board unless the wire does not involve the board.',
    parameters: {
      type: 'object',
      properties: {
        fromComponentId: COMPONENT_ID,
        fromPin: { type: 'string' },
        toComponentId: COMPONENT_ID,
        toPin: { type: 'string' },
      },
      required: ['fromComponentId', 'fromPin', 'toComponentId', 'toPin'],
      additionalProperties: false,
    },
  },
  {
    name: 'disconnect_pins',
    description:
      'Stage removing the wire between two pins. Only when the user asked for it or a rewire requires it.',
    parameters: {
      type: 'object',
      properties: {
        fromComponentId: COMPONENT_ID,
        fromPin: { type: 'string' },
        toComponentId: COMPONENT_ID,
        toPin: { type: 'string' },
      },
      required: ['fromComponentId', 'fromPin', 'toComponentId', 'toPin'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_source_file',
    description:
      'Stage the full new contents of one source file. Read the file first and return it with your change applied, preserving the existing functions, Wi-Fi and network logic, comments, and structure. Do not replace a working sketch with a fresh one.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Project-relative path, e.g. src/main.ino',
        },
        content: {
          type: 'string',
          description: 'The complete file after your change.',
        },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
];

const WIDGET_TYPE = {
  type: 'string',
  description:
    'One of: switch, button, slider, numeric-input, value, gauge, progress, status, led, line-chart, bar-chart, pie-chart, table, event-log, terminal, text, divider. Gauge or value for a reading, line-chart for history, switch/button/slider for an output, led or status for an on/off state.',
} as const;

/**
 * Dashboard tools. They stage one dashboard change, shown to the user as a preview and
 * written only if accepted. A widget binds to a datastream, and a datastream names a
 * part in this project, so a widget for hardware the project lacks cannot be staged.
 */
export const DASHBOARD_TOOLS: readonly AiToolDefinition[] = [
  {
    name: 'define_datastream',
    description:
      'Stage a datastream: a named value the firmware sends or receives, which widgets bind to. Name the part it comes from with componentId (from the context or add_device). Use the same key in the sketch.',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description:
            'e.g. temperature, humidity, relay1. Letters, digits, _.',
        },
        name: {
          type: 'string',
          description: 'Human label, e.g. "Room temperature".',
        },
        dataType: { type: 'string', enum: ['number', 'boolean', 'string'] },
        unit: {
          type: 'string',
          description: 'e.g. °C, %, V. Empty when none.',
        },
        min: { type: 'number' },
        max: { type: 'number' },
        componentId: COMPONENT_ID,
        source: {
          type: 'string',
          description:
            'The part property that produces it, e.g. temperature or humidity.',
        },
      },
      required: ['key', 'name', 'dataType'],
      additionalProperties: false,
    },
  },
  {
    name: 'place_widget',
    description:
      'Stage a new widget bound to a datastream. The platform places it in the first free spot on every screen size; widgets never overlap.',
    parameters: {
      type: 'object',
      properties: {
        type: WIDGET_TYPE,
        title: { type: 'string' },
        datastream: {
          type: 'string',
          description:
            'Datastream key. Omit only for text, divider, terminal, event-log.',
        },
        cols: {
          type: 'integer',
          description:
            'Width on the 12-column desktop grid. Omit for the default.',
        },
        rows: {
          type: 'integer',
          description: 'Height in grid rows. Omit for the default.',
        },
        unit: { type: 'string' },
        decimals: { type: 'integer' },
      },
      required: ['type'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_widget',
    description:
      'Stage a change to a widget: rename, rebind, move (desktop x/y), or resize. A move onto another widget is refused.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Widget id from read_dashboard or place_widget.',
        },
        title: { type: 'string' },
        datastream: { type: 'string' },
        x: { type: 'integer' },
        y: { type: 'integer' },
        cols: { type: 'integer' },
        rows: { type: 'integer' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_widget',
    description: 'Stage removing a widget. Only when the user asked for it.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'arrange_dashboard',
    description:
      'Stage packing every widget neatly from the top-left in its current order, on desktop, tablet, and mobile.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

export const PROJECT_TOOLS: readonly AiToolDefinition[] = [
  ...READ_TOOLS,
  ...WRITE_TOOLS,
  ...DASHBOARD_TOOLS,
];

const WRITE_TOOL_NAMES = new Set(
  [...WRITE_TOOLS, ...DASHBOARD_TOOLS].map((tool) => tool.name),
);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOL_NAMES.has(name);
}
