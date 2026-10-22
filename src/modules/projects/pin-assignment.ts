/**
 * The hardware authority.
 *
 * Every wire the platform creates — drawn by a user or requested by a model — is decided
 * here, against the device catalog and the project's own components. The rule this file
 * exists to enforce is that a language model never invents wiring: it states an intent
 * ("put the DHT22 data line on a free GPIO"), and these functions answer with a concrete,
 * legal pin or a refusal. Nothing in the AI path bypasses them.
 *
 * Everything is a pure function of a `CircuitState` snapshot, for one reason: the same
 * code must judge a wire that already exists in the database and one that only exists in
 * a proposal the user has not accepted yet. A service that read the database itself could
 * do the first but not the second, and the two would drift apart — which is precisely the
 * failure where the generated code says GPIO4 and the diagram says GPIO5.
 *
 * The checks that *refuse* are the ones a wire cannot survive: a missing pin, an
 * incompatible pin kind, a pin already at its fan-out limit, a dead short. Checks that a
 * real breadboard would merely raise an eyebrow at — an unprotected LED, a shared bus —
 * stay advisory, matching the canvas's own wiring checks, and are returned as warnings.
 */

import {
  candidatePins,
  findDevice,
  findPin,
  requiredBoardPinType,
} from './catalog/device-catalog';
import {
  CatalogDevice,
  CatalogPin,
  ConnectionKind,
  PinType,
  isPassivePinType,
} from './catalog/device-catalog.types';

/** One placed component, reduced to what wiring decisions depend on. */
export interface CircuitComponent {
  readonly id: string;
  readonly definitionId: string;
  readonly label: string;
}

export interface CircuitEndpoint {
  readonly componentId: string;
  readonly pinId: string;
}

export interface CircuitConnection {
  readonly id: string;
  readonly from: CircuitEndpoint;
  readonly to: CircuitEndpoint;
  readonly kind: ConnectionKind;
}

export interface CircuitState {
  readonly components: readonly CircuitComponent[];
  readonly connections: readonly CircuitConnection[];
}

/** A refusal carrying a stable code, so the caller maps it to HTTP without string matching. */
export class WiringError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WiringError';
  }
}

export interface WiringWarning {
  readonly code: string;
  readonly message: string;
}

/** A wire that passed validation, with both endpoints resolved to canonical pin ids. */
export interface ValidatedConnection {
  readonly from: CircuitEndpoint;
  readonly to: CircuitEndpoint;
  readonly kind: ConnectionKind;
  readonly color: string;
  readonly warnings: readonly WiringWarning[];
}

/**
 * Wire colours, matching what the canvas draws for a hand-made wire.
 *
 * A wire the assistant created must be indistinguishable from one the user drew; a
 * different palette would turn "who made this" into a visual property of the circuit.
 */
const WIRE_COLORS: Readonly<Record<ConnectionKind, string>> = {
  ground: '#111827',
  power: '#ef4444',
  signal: '#22c55e',
};

export function resolveComponent(
  state: CircuitState,
  componentId: string,
): CircuitComponent {
  const component = state.components.find((item) => item.id === componentId);
  if (!component) {
    throw new WiringError(
      'COMPONENT_NOT_FOUND',
      `No component "${componentId}" in this project`,
    );
  }
  return component;
}

/**
 * The catalog definition behind a placed component.
 *
 * A project may hold a component whose definition the API cannot describe — the create
 * dialog offers seven boards and the drawing catalog defines three. That is a real state,
 * not a corruption, so it refuses with its own code rather than pretending the part is
 * absent.
 */
export function resolveDefinition(component: CircuitComponent): CatalogDevice {
  const definition = findDevice(component.definitionId);
  if (!definition) {
    throw new WiringError(
      'DEFINITION_NOT_IN_CATALOG',
      `"${component.definitionId}" has no pinout the platform can validate against`,
    );
  }
  return definition;
}

export function resolvePin(
  definition: CatalogDevice,
  pinId: string,
): CatalogPin {
  const pin = findPin(definition.id, pinId);
  if (!pin) {
    throw new WiringError(
      'PIN_NOT_FOUND',
      `${definition.name} has no pin "${pinId}"`,
    );
  }
  return pin;
}

/** The board a project's firmware runs on, or null when it holds none. */
export function findBoard(state: CircuitState): CircuitComponent | null {
  return (
    state.components.find(
      (component) => findDevice(component.definitionId)?.isBoard,
    ) ?? null
  );
}

/** Wires touching one pin. Fan-out and reuse decisions both count these. */
export function wiresOnPin(
  state: CircuitState,
  endpoint: CircuitEndpoint,
): readonly CircuitConnection[] {
  return state.connections.filter(
    (connection) =>
      sameEndpoint(connection.from, endpoint) ||
      sameEndpoint(connection.to, endpoint),
  );
}

function sameEndpoint(a: CircuitEndpoint, b: CircuitEndpoint): boolean {
  return (
    a.componentId === b.componentId &&
    a.pinId.toUpperCase() === b.pinId.toUpperCase()
  );
}

/**
 * The wiring kind of a wire between two pins.
 *
 * Ground wins over power so that a supply pin joined to a ground pin is drawn — and
 * reported — as the short it is, rather than as an ordinary rail.
 */
function kindOf(a: CatalogPin, b: CatalogPin): ConnectionKind {
  if (a.kind === 'ground' || b.kind === 'ground') return 'ground';
  if (a.kind === 'power' || b.kind === 'power') return 'power';
  return 'signal';
}

/**
 * Decides whether one wire may exist, and returns it in canonical form.
 *
 * Endpoints come back with catalog pin ids rather than whatever spelling the caller used,
 * so a wire requested against the silkscreen name `D4` is stored on `GPIO4` — one hole,
 * one id, no chance of the same pin appearing twice under two names.
 */
export function validateConnection(
  state: CircuitState,
  from: CircuitEndpoint,
  to: CircuitEndpoint,
): ValidatedConnection {
  const fromComponent = resolveComponent(state, from.componentId);
  const toComponent = resolveComponent(state, to.componentId);
  const fromDefinition = resolveDefinition(fromComponent);
  const toDefinition = resolveDefinition(toComponent);
  const fromPin = resolvePin(fromDefinition, from.pinId);
  const toPin = resolvePin(toDefinition, to.pinId);

  const canonicalFrom: CircuitEndpoint = {
    componentId: fromComponent.id,
    pinId: fromPin.name,
  };
  const canonicalTo: CircuitEndpoint = {
    componentId: toComponent.id,
    pinId: toPin.name,
  };

  if (sameEndpoint(canonicalFrom, canonicalTo)) {
    throw new WiringError(
      'CONNECTION_SELF_LOOP',
      'A pin cannot be connected to itself',
    );
  }

  if (fromPin.type === 'nc' || toPin.type === 'nc') {
    throw new WiringError(
      'PIN_NOT_CONNECTED_INTERNALLY',
      `${fromPin.type === 'nc' ? fromDefinition.name : toDefinition.name} pin "${
        fromPin.type === 'nc' ? fromPin.name : toPin.name
      }" is not connected internally and cannot carry a signal`,
    );
  }

  // Checked before the general kind rule, which would also catch this pairing but would
  // report it as a mismatch. "This shorts the supply to ground" is the fact the user
  // needs; "a power pin met a ground pin" leaves them to work that out.
  if (
    (fromPin.type === 'vcc' && toPin.type === 'gnd') ||
    (fromPin.type === 'gnd' && toPin.type === 'vcc')
  ) {
    throw new WiringError(
      'POWER_GROUND_SHORT',
      `${fromDefinition.name}:${fromPin.name} to ${toDefinition.name}:${toPin.name} shorts the supply to ground`,
    );
  }

  // Both ends must agree on what the wire carries. A passive lead has no opinion, so it
  // joins power, ground, and signal alike — without this a resistor could not reach
  // ground at all.
  const passiveEnd =
    isPassivePinType(fromPin.type) || isPassivePinType(toPin.type);
  if (!passiveEnd && fromPin.kind !== toPin.kind) {
    throw new WiringError(
      'PIN_KIND_MISMATCH',
      `${fromDefinition.name}:${fromPin.name} is a ${fromPin.kind} pin and ${toDefinition.name}:${toPin.name} is a ${toPin.kind} pin`,
    );
  }

  const duplicate = state.connections.find(
    (connection) =>
      (sameEndpoint(connection.from, canonicalFrom) &&
        sameEndpoint(connection.to, canonicalTo)) ||
      (sameEndpoint(connection.from, canonicalTo) &&
        sameEndpoint(connection.to, canonicalFrom)),
  );
  if (duplicate) {
    throw new WiringError(
      'CONNECTION_ALREADY_EXISTS',
      `${fromDefinition.name}:${fromPin.name} is already wired to ${toDefinition.name}:${toPin.name}`,
    );
  }

  assertFanoutAllows(state, canonicalFrom, fromPin, fromDefinition);
  assertFanoutAllows(state, canonicalTo, toPin, toDefinition);

  const warnings: WiringWarning[] = [];

  // Two driven outputs on one node fight the moment they disagree. It is a warning
  // rather than a refusal because open-drain parts share a line deliberately.
  if (fromPin.direction === 'output' && toPin.direction === 'output') {
    warnings.push({
      code: 'output-conflict',
      message: `${fromDefinition.name}:${fromPin.name} and ${toDefinition.name}:${toPin.name} are both outputs`,
    });
  }

  warnings.push(
    ...protocolWarnings(fromPin, fromDefinition, toPin, toDefinition),
  );
  warnings.push(
    ...logicLevelWarnings(fromPin, fromDefinition, toPin, toDefinition),
  );
  warnings.push(
    ...logicLevelWarnings(toPin, toDefinition, fromPin, fromDefinition),
  );
  warnings.push(
    ...spiChipSelectWarnings(state, canonicalFrom, fromPin, canonicalTo, toPin),
  );

  warnings.push(...voltageWarnings(fromPin, toDefinition, toPin));
  warnings.push(...voltageWarnings(toPin, fromDefinition, fromPin));

  const kind = kindOf(fromPin, toPin);
  return {
    from: canonicalFrom,
    to: canonicalTo,
    kind,
    color: WIRE_COLORS[kind],
    warnings,
  };
}

function protocolWarnings(
  fromPin: CatalogPin,
  fromDevice: CatalogDevice,
  toPin: CatalogPin,
  toDevice: CatalogDevice,
): readonly WiringWarning[] {
  const sameUartRole =
    (fromPin.type === 'uart-tx' && toPin.type === 'uart-tx') ||
    (fromPin.type === 'uart-rx' && toPin.type === 'uart-rx');
  if (!sameUartRole) return [];
  return [
    {
      code: 'uart-polarity',
      message: `${fromDevice.name}:${fromPin.name} and ${toDevice.name}:${toPin.name} are both ${fromPin.type === 'uart-tx' ? 'TX' : 'RX'}; UART must cross TX to RX`,
    },
  ];
}

function logicLevelWarnings(
  sourcePin: CatalogPin,
  sourceDevice: CatalogDevice,
  targetPin: CatalogPin,
  targetDevice: CatalogDevice,
): readonly WiringWarning[] {
  if (sourcePin.direction !== 'output' || targetPin.direction === 'output')
    return [];
  const volts = sourcePin.voltage ?? sourceDevice.logicVoltage;
  const limit = targetPin.maxInputVoltage ?? targetDevice.maxLogicInputVoltage;
  if (volts === undefined || limit === undefined || volts <= limit + 0.05)
    return [];
  return [
    {
      code: 'logic-overvoltage',
      message: `${sourceDevice.name}:${sourcePin.name} drives ${volts} V but ${targetDevice.name}:${targetPin.name} accepts at most ${limit} V; use a divider or level shifter`,
    },
  ];
}

function spiChipSelectWarnings(
  state: CircuitState,
  from: CircuitEndpoint,
  fromPin: CatalogPin,
  to: CircuitEndpoint,
  toPin: CatalogPin,
): readonly WiringWarning[] {
  const peripheral =
    fromPin.type === 'spi-cs' ? from : toPin.type === 'spi-cs' ? to : null;
  const shared = peripheral === from ? to : peripheral === to ? from : null;
  if (!peripheral || !shared) return [];

  const conflict = state.connections.some((connection) => {
    const other = sameEndpoint(connection.from, shared)
      ? connection.to
      : sameEndpoint(connection.to, shared)
        ? connection.from
        : null;
    if (!other || sameEndpoint(other, peripheral)) return false;
    const component = state.components.find(
      (candidate) => candidate.id === other.componentId,
    );
    if (!component) return false;
    return (
      resolvePin(resolveDefinition(component), other.pinId).type === 'spi-cs'
    );
  });
  return conflict
    ? [
        {
          code: 'spi-cs-conflict',
          message:
            'Two SPI peripherals share one chip-select pin; assign a separate CS pin to each device',
        },
      ]
    : [];
}

function assertFanoutAllows(
  state: CircuitState,
  endpoint: CircuitEndpoint,
  pin: CatalogPin,
  definition: CatalogDevice,
): void {
  if (pin.multipleConnections !== false) return;
  if (wiresOnPin(state, endpoint).length === 0) return;

  throw new WiringError(
    'PIN_FANOUT_EXCEEDED',
    `${definition.name}:${pin.name} accepts only one wire and already has one`,
  );
}

/** A rail above what the part on the other end is rated for. */
function voltageWarnings(
  supplyPin: CatalogPin,
  target: CatalogDevice,
  targetPin: CatalogPin,
): readonly WiringWarning[] {
  if (supplyPin.type !== 'vcc' || targetPin.type !== 'vcc') return [];

  const rail = supplyPin.voltage;
  const window = target.operatingVoltage;
  if (rail === undefined || window === undefined) return [];

  if (rail > window.max + 0.05) {
    return [
      {
        code: 'overvoltage',
        message: `${target.name} tops out at ${window.max} V but this wire feeds it ${rail} V`,
      },
    ];
  }

  // The quieter half of the same mistake. Too much voltage damages a part visibly; too
  // little just leaves it inert — a relay coil that never pulls in, a module that never
  // answers — and nothing about the diagram says why.
  if (rail < window.min - 0.05) {
    return [
      {
        code: 'undervoltage',
        message: `${target.name} needs at least ${window.min} V but this wire feeds it ${rail} V, so it will not run`,
      },
    ];
  }

  return [];
}

export interface PinRequirement {
  /** Catalog pin on the peripheral that needs a home, e.g. `DATA`. */
  readonly peripheralPinId: string;
  /** Pin the caller wants used. Validated like any other; never assumed free. */
  readonly preferredBoardPinId?: string;
}

export interface PinAssignment {
  readonly peripheralPin: string;
  readonly boardPin: string;
  readonly kind: ConnectionKind;
  /** True when the pin was already wired this way and is being reused, not assigned. */
  readonly reused: boolean;
}

/**
 * Chooses a board pin for one peripheral pin.
 *
 * Order of preference, which is the product rule in section 3 expressed in code:
 *
 *   1. an existing wire — a peripheral already wired to a pin keeps that pin, so asking
 *      the assistant a second question never silently rewires the board;
 *   2. the caller's preference, if it is legal and free;
 *   3. the first free pin of a compatible type, in the board's own header order.
 *
 * Supply and ground pins deliberately fall to a *shared* board pin rather than an unused
 * one: `3V3` hosts every peripheral's VCC on a real board, and spreading them across
 * separate holes would be wrong as well as impossible.
 */
export function assignBoardPin(
  state: CircuitState,
  board: CircuitComponent,
  peripheral: CircuitComponent,
  requirement: PinRequirement,
): PinAssignment {
  const boardDefinition = resolveDefinition(board);
  const peripheralDefinition = resolveDefinition(peripheral);
  const peripheralPin = resolvePin(
    peripheralDefinition,
    requirement.peripheralPinId,
  );

  if (peripheralPin.type === 'nc') {
    throw new WiringError(
      'PIN_NOT_CONNECTED_INTERNALLY',
      `${peripheralDefinition.name}:${peripheralPin.name} is not connected internally`,
    );
  }

  // A bare two-terminal lead — an LED leg, a resistor lead, a switch pole — carries no
  // intent about what belongs on it, which is right for validating a wire and useless
  // for choosing one. Every board pin "satisfies" it, so automatic assignment would
  // cheerfully put an LED's anode and its cathode on the same 3V3 rail. Which leg faces
  // the supply and which faces ground is a circuit decision, not a pin-capability one,
  // so it is refused here and the caller has to state both ends explicitly.
  if (isPassivePinType(peripheralPin.type)) {
    throw new WiringError(
      'PIN_NEEDS_EXPLICIT_WIRING',
      `${peripheralDefinition.name}:${peripheralPin.name} is a passive lead, so the platform cannot choose a board pin for it. Wire it with connect_pins instead. ${passiveWiringHint(peripheralDefinition)} Do not call add_device or wire_to_board for this part again.`,
    );
  }

  const existing = existingBoardPin(state, board, peripheral, peripheralPin);
  if (existing) {
    return {
      peripheralPin: peripheralPin.name,
      boardPin: existing.name,
      kind: kindOf(peripheralPin, existing),
      reused: true,
    };
  }

  const required = requiredBoardPinType(peripheralPin);
  const candidates = rankSupplyByVoltage(
    candidatePins(boardDefinition, required),
    peripheralDefinition,
  );
  if (!candidates.length) {
    throw new WiringError(
      'NO_COMPATIBLE_PIN',
      `${boardDefinition.name} has no pin that can serve ${peripheralDefinition.name}:${peripheralPin.name}`,
    );
  }

  const chosen = requirement.preferredBoardPinId
    ? preferredOrRefuse(
        state,
        board,
        boardDefinition,
        candidates,
        requirement.preferredBoardPinId,
        peripheralPin,
      )
    : firstUsable(
        state,
        board,
        preferProtocolDefaults(
          preferSide(
            state,
            board,
            boardDefinition,
            peripheral,
            candidates,
            required,
          ),
          boardDefinition,
          required,
        ),
        peripheralPin,
      );

  if (!chosen) {
    throw new WiringError(
      'NO_FREE_PIN',
      `Every ${required} pin on ${boardDefinition.name} is already in use`,
    );
  }

  return {
    peripheralPin: peripheralPin.name,
    boardPin: chosen.name,
    kind: kindOf(peripheralPin, chosen),
    reused: false,
  };
}

/** Hardware SPI calls use these board pins unless the sketch remaps SPI.begin(). */
function preferProtocolDefaults(
  candidates: readonly CatalogPin[],
  board: CatalogDevice,
  required: PinType,
): readonly CatalogPin[] {
  const preferred =
    required === 'spi-mosi'
      ? board.defaultSpi?.mosi
      : required === 'spi-miso'
        ? board.defaultSpi?.miso
        : required === 'spi-sck'
          ? board.defaultSpi?.clock
          : required === 'spi-cs'
            ? board.defaultSpi?.select
            : undefined;
  if (!preferred) return candidates;
  return [...candidates].sort(
    (a, b) => Number(b.name === preferred) - Number(a.name === preferred),
  );
}

/**
 * Puts the supply rails a part can actually run on ahead of the ones it cannot.
 *
 * A board offers more than one rail — an ESP32 has 3V3 and VIN — and header order alone
 * picks the first, which is how a 5 V relay module ends up powered from 3.3 V. That is not
 * a wire the user can debug by looking at it: the diagram is tidy, the code is right, and
 * the coil simply never pulls in.
 *
 * Among the rails inside the part's declared window, the **lowest** wins. Two reasons, and
 * neither is "closest to recommended", which is the rule this started as and which was
 * wrong: it moved a DHT22 onto VIN because the datasheet prefers 5 V, and then its data
 * line was sitting at 5 V while the GPIO reading it is a 3.3 V input. The lowest rail a
 * part is rated for is the one that matches the board's own logic level in practice, and a
 * part that genuinely cannot run there — the relay coil, with a 4.5 V minimum — is excluded
 * by its own `min` rather than by a special case. It also keeps peripherals on a shared
 * rail, which is what a real breadboard looks like.
 *
 * A caller who wants the higher rail says so with `preferredBoardPinId`.
 *
 * Rails outside the window keep their order behind the usable ones rather than being
 * removed: a part with no rail in range still has to be wired somewhere, and
 * `validateConnection` reports what is wrong with the result.
 *
 * Anything that is not a supply pin passes through untouched.
 */
function rankSupplyByVoltage(
  candidates: readonly CatalogPin[],
  peripheral: CatalogDevice,
): readonly CatalogPin[] {
  const window = peripheral.operatingVoltage;
  if (!window || !candidates.some((pin) => pin.type === 'vcc'))
    return candidates;

  const inRange = (pin: CatalogPin): boolean =>
    pin.voltage !== undefined &&
    pin.voltage >= window.min - 0.05 &&
    pin.voltage <= window.max + 0.05;

  const usable = candidates
    .filter(inRange)
    .sort((a, b) => (a.voltage as number) - (b.voltage as number));

  return [...usable, ...candidates.filter((pin) => !inRange(pin))];
}

/** The board pin this peripheral pin is already wired to, if any. */
function existingBoardPin(
  state: CircuitState,
  board: CircuitComponent,
  peripheral: CircuitComponent,
  peripheralPin: CatalogPin,
): CatalogPin | null {
  const endpoint: CircuitEndpoint = {
    componentId: peripheral.id,
    pinId: peripheralPin.name,
  };

  for (const connection of wiresOnPin(state, endpoint)) {
    const other = sameEndpoint(connection.from, endpoint)
      ? connection.to
      : connection.from;
    if (other.componentId !== board.id) continue;

    const pin = findPin(board.definitionId, other.pinId);
    if (pin) return pin;
  }

  return null;
}

function preferredOrRefuse(
  state: CircuitState,
  board: CircuitComponent,
  boardDefinition: CatalogDevice,
  candidates: readonly CatalogPin[],
  preferredPinId: string,
  peripheralPin: CatalogPin,
): CatalogPin {
  const preferred = resolvePin(boardDefinition, preferredPinId);

  if (!candidates.some((pin) => pin.name === preferred.name)) {
    throw new WiringError(
      'PIN_CAPABILITY_MISMATCH',
      `${boardDefinition.name}:${preferred.name} is a ${preferred.type} pin and cannot serve a ${peripheralPin.type} line`,
    );
  }

  if (!isUsable(state, board, preferred, peripheralPin)) {
    throw new WiringError(
      'PIN_ALREADY_IN_USE',
      `${boardDefinition.name}:${preferred.name} is already wired`,
    );
  }

  return preferred;
}

function firstUsable(
  state: CircuitState,
  board: CircuitComponent,
  candidates: readonly CatalogPin[],
  peripheralPin: CatalogPin,
): CatalogPin | null {
  return (
    candidates.find((pin) => isUsable(state, board, pin, peripheralPin)) ?? null
  );
}

/**
 * Whether a board pin can take one more wire.
 *
 * Rails are shared on purpose; a signal pin is not, because two peripherals reading the
 * same GPIO is almost always a mistake rather than a design.
 */
function isUsable(
  state: CircuitState,
  board: CircuitComponent,
  boardPin: CatalogPin,
  peripheralPin: CatalogPin,
): boolean {
  const endpoint: CircuitEndpoint = {
    componentId: board.id,
    pinId: boardPin.name,
  };
  const used = wiresOnPin(state, endpoint).length;

  if (boardPin.multipleConnections === false) return used === 0;
  if (isRail(boardPin) && isRail(peripheralPin)) return true;
  return used === 0;
}

function isRail(pin: CatalogPin): boolean {
  return pin.type === 'vcc' || pin.type === 'gnd';
}

/**
 * Every pin of a board with what currently occupies it.
 *
 * This is what the assistant is shown instead of being asked to remember a pinout: the
 * board's own pins, their capabilities, and which are taken — so "use a free GPIO" has an
 * answer it can read rather than guess.
 */
export interface PinoutEntry {
  readonly pin: string;
  readonly type: PinType;
  readonly kind: ConnectionKind;
  readonly direction: string;
  readonly aliases: readonly string[];
  readonly description?: string;
  readonly voltage?: number;
  /** Components wired to this pin, as `label:pin`. Empty when the pin is free. */
  readonly connectedTo: readonly string[];
}

export function pinoutOf(
  state: CircuitState,
  component: CircuitComponent,
): readonly PinoutEntry[] {
  const definition = resolveDefinition(component);
  const labels = new Map(state.components.map((item) => [item.id, item.label]));

  return definition.pins.map((pin) => {
    const endpoint: CircuitEndpoint = {
      componentId: component.id,
      pinId: pin.name,
    };
    const connectedTo = wiresOnPin(state, endpoint).map((connection) => {
      const other = sameEndpoint(connection.from, endpoint)
        ? connection.to
        : connection.from;
      return `${labels.get(other.componentId) ?? other.componentId}:${other.pinId}`;
    });

    return {
      pin: pin.name,
      type: pin.type,
      kind: pin.kind,
      direction: pin.direction,
      aliases: pin.aliases ?? [],
      ...(pin.description ? { description: pin.description } : {}),
      ...(pin.voltage !== undefined ? { voltage: pin.voltage } : {}),
      connectedTo,
    };
  });
}

/**
 * A part whose two leads ended up on the same electrical node.
 *
 * This is how a series resistor gets built and then quietly bypassed: the LED's anode is
 * wired through the resistor to a GPIO *and* straight to the same GPIO. Every wire is
 * legal on its own — that is why nothing here refuses one — but the resistor now has the
 * same potential at both ends, carries no current, and limits nothing. The LED is driven
 * exactly as hard as it would be with no resistor at all, which is the failure the
 * resistor was added to prevent.
 *
 * A node is what a wire joins, and a component body does not join anything: the two leads
 * of a resistor are different nodes unless something outside it connects them. So the
 * check is simply whether two of a limiter's wired leads reach the same node.
 */
export interface BypassedLimiter {
  readonly component: CircuitComponent;
  /** The leads that meet, in the order the definition declares them. */
  readonly pins: readonly [string, string];
}

export function bypassedCurrentLimiters(
  state: CircuitState,
): readonly BypassedLimiter[] {
  const nodes = electricalNodes(state);
  const bypassed: BypassedLimiter[] = [];

  for (const component of state.components) {
    const definition = findDevice(component.definitionId);
    if (!definition?.limitsCurrent) continue;

    const wired = definition.pins
      .map((pin) => ({
        name: pin.name,
        node: nodes.get(`${component.id}:${pin.name}`),
      }))
      .filter(
        (entry): entry is { name: string; node: string } =>
          entry.node !== undefined,
      );

    const shorted = wired.find((lead, index) =>
      wired.slice(index + 1).some((other) => other.node === lead.node),
    );
    if (!shorted) continue;

    const other = wired.find(
      (entry) => entry.node === shorted.node && entry.name !== shorted.name,
    );
    if (other) bypassed.push({ component, pins: [shorted.name, other.name] });
  }

  return bypassed;
}

/**
 * Every wired pin, labelled with the node it belongs to.
 *
 * Union-find over the wires alone. Nothing conducts through a component, which is the
 * whole point: treating a part as a connection would merge the two sides of every resistor
 * and make the check above always true.
 */
function electricalNodes(state: CircuitState): ReadonlyMap<string, string> {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const seen = parent.get(key);
    if (seen === undefined || seen === key) return key;
    const root = find(seen);
    parent.set(key, root);
    return root;
  };

  for (const connection of state.connections) {
    const from = `${connection.from.componentId}:${connection.from.pinId}`;
    const to = `${connection.to.componentId}:${connection.to.pinId}`;
    if (!parent.has(from)) parent.set(from, from);
    if (!parent.has(to)) parent.set(to, to);
    parent.set(find(from), find(to));
  }

  return new Map([...parent.keys()].map((key) => [key, find(key)]));
}

/**
 * How a part with bare leads is normally wired, for the refusal that asks the caller
 * to wire it by hand. The advice has to fit the part: telling a model to face a push
 * button's "anode" toward the supply sent it round in circles re-adding the button.
 */
function passiveWiringHint(definition: CatalogDevice): string {
  if (definition.requiresSeriesResistor) {
    return 'Typically: a board GPIO to a series resistor, the resistor to the anode, the cathode to a board GND.';
  }
  const isSwitch =
    definition.interfaces.includes('digital') &&
    definition.pins.every((pin) => isPassivePinType(pin.type));
  if (isSwitch) {
    return 'For a switch or button: one side to a free digital GPIO chosen from get_board_pinout, the other side to a board GND, and read it with INPUT_PULLUP (pressed reads LOW). No resistor is needed. Use two pins on opposite sides of the switch, not two that are always connected.';
  }
  return 'Decide which lead faces the supply and which faces ground, and connect both ends.';
}

/**
 * Reorders equally good board pins so a part's wires stay on one side of the board,
 * and new parts fill the emptier side.
 *
 * Header order alone put every part on the left header: the canvas then stacked them
 * all on one side, their wires crossed each other, and ground ran across the board
 * from the far GND. So among pins that are otherwise equal — the same type class and
 * the same rail voltage — the side this part is already wired to comes first, and a
 * part with no wires yet goes to the side with fewer occupied pins. It never lifts a
 * substitute above an exact type (I2C stays on SDA/SCL) or a rail above a better
 * rail; header order still breaks ties, so the result stays deterministic.
 */
function preferSide(
  state: CircuitState,
  board: CircuitComponent,
  boardDefinition: CatalogDevice,
  peripheral: CircuitComponent,
  candidates: readonly CatalogPin[],
  required: PinType,
): readonly CatalogPin[] {
  const sideOf = (pinName: string) =>
    findPin(boardDefinition.id, pinName)?.side;
  const occupied = { left: 0, right: 0 };
  const ownSides = { left: 0, right: 0 };

  for (const connection of state.connections) {
    for (const [end, other] of [
      [connection.from, connection.to],
      [connection.to, connection.from],
    ] as const) {
      if (end.componentId !== board.id) continue;
      const side = sideOf(end.pinId);
      if (side !== 'left' && side !== 'right') continue;
      const pin = findPin(boardDefinition.id, end.pinId);
      if (pin && !isRail(pin)) occupied[side]++;
      if (other.componentId === peripheral.id) ownSides[side]++;
    }
  }

  let preferred: 'left' | 'right' | null = null;
  if (ownSides.left !== ownSides.right) {
    preferred = ownSides.left > ownSides.right ? 'left' : 'right';
  } else if (occupied.left !== occupied.right) {
    preferred = occupied.left < occupied.right ? 'left' : 'right';
  }
  if (!preferred) return candidates;

  // Tiers keep the ranking already made: exact type before substitute, and each rail
  // voltage in the order rankSupplyByVoltage chose.
  const tierOf = (pin: CatalogPin) =>
    `${pin.type === required ? 0 : 1}|${pin.type === 'vcc' ? String(pin.voltage) : ''}`;
  const firstIndex = new Map<string, number>();
  candidates.forEach((pin, index) => {
    const tier = tierOf(pin);
    if (!firstIndex.has(tier)) firstIndex.set(tier, index);
  });

  return candidates
    .map((pin, index) => ({ pin, index }))
    .sort(
      (a, b) =>
        (firstIndex.get(tierOf(a.pin)) ?? 0) -
          (firstIndex.get(tierOf(b.pin)) ?? 0) ||
        Number(a.pin.side !== preferred) - Number(b.pin.side !== preferred) ||
        a.index - b.index,
    )
    .map(({ pin }) => pin);
}
