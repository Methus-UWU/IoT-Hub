import {
  CircuitComponent,
  CircuitConnection,
  CircuitEndpoint,
  CircuitState,
  PinAssignment,
  WiringError,
  WiringWarning,
  assignBoardPin,
  findBoard,
  resolveComponent,
  resolveDefinition,
  validateConnection,
} from '../../projects/pin-assignment';
import {
  DeviceSettings,
  findDevice,
  findPin,
} from '../../projects/catalog/device-catalog';
import type { DashboardDocument } from '../../dashboards/dashboard-document';
import { DashboardDatastream, DashboardDraft } from './dashboard-draft';
import { ProjectDiagnosticsDto } from './dto/project-ai.dto';
import { renderProblems } from './project-problems';

/**
 * A proposed change to a project, held apart from the project itself.
 *
 * The assistant needs to know the pin a sensor will end up on *before* it writes the code
 * that reads that pin. It cannot be told to remember one it picked, because it does not
 * pick: the assignment engine does. So a request runs against this draft — a copy of the
 * project's components, wires, and files that accepts changes and answers questions about
 * the result — and the concrete pin comes straight back as a tool result. `#define
 * DHT_PIN 4` is then something the model read, not something it guessed.
 *
 * Nothing here writes. A draft is a list of intentions plus the state they would produce,
 * and it is thrown away unless the user applies it. That is also what makes the same code
 * usable at apply time: the plan is replayed against a fresh draft built from live state,
 * so a project that changed in between is refused rather than half-written.
 */

export type PlannedAction =
  | {
      readonly type: 'add_device';
      /** Placeholder id this action introduces, referenced by later actions. */
      readonly ref: string;
      readonly definitionId: string;
      readonly label: string;
      /** Configured values, e.g. an LED's colour. Stored as the component's state. */
      readonly settings?: DeviceSettings;
    }
  | {
      /** Changes settings on a part the project already has. */
      readonly type: 'configure';
      readonly componentId: string;
      readonly settings: DeviceSettings;
    }
  | {
      readonly type: 'connect';
      readonly from: CircuitEndpoint;
      readonly to: CircuitEndpoint;
      readonly kind: 'power' | 'ground' | 'signal';
      readonly color: string;
    }
  | {
      readonly type: 'disconnect';
      readonly connectionId: string;
      /** Kept for the preview, which describes wires rather than naming ids. */
      readonly summary: string;
    }
  | {
      readonly type: 'write_file';
      readonly path: string;
      readonly content: string;
      readonly created: boolean;
    }
  | {
      /** The whole dashboard as the assistant left it, plus the datastreams it added. */
      readonly type: 'set_dashboard';
      readonly document: DashboardDocument;
      readonly datastreams: readonly DashboardDatastream[];
      /** The dashboard version the proposal was built on; 0 when there was none. */
      readonly baseVersion: number;
    };

export interface DraftFile {
  readonly content: string;
  readonly exists: boolean;
}

/** Placeholder for a component the plan creates. Never a database id. */
export const NEW_COMPONENT_PREFIX = 'new:';

export function isPlaceholderRef(ref: string): boolean {
  return ref.startsWith(NEW_COMPONENT_PREFIX);
}

export class ProjectDraft {
  private readonly addedComponents: CircuitComponent[] = [];
  private readonly addedConnections: CircuitConnection[] = [];
  private readonly removedConnectionIds = new Set<string>();
  private readonly writtenFiles = new Map<string, string>();
  private readonly reviewedDatasheets = new Set<string>();
  private readonly plan: PlannedAction[] = [];
  private sequence = 0;
  /** Absent when the project's dashboard could not be loaded this turn. */
  private dashboardDraft: DashboardDraft | null = null;

  constructor(
    private readonly base: CircuitState,
    private readonly files: ReadonlyMap<string, DraftFile>,
    /** What the user's IDE reported this turn. Absent when the client sent nothing. */
    private readonly diagnostics?: ProjectDiagnosticsDto,
  ) {}

  /**
   * Problems in the project as it stands, including anything staged so far.
   *
   * Audited against the draft rather than the stored circuit so that a wire the model has
   * just staged counts as connected — otherwise it would be told a part it has only now
   * powered is still unpowered.
   */
  problems(): string {
    return renderProblems(this.state(), this.diagnostics);
  }

  /** The project as it would be once every staged action had been applied. */
  state(): CircuitState {
    return {
      components: [...this.base.components, ...this.addedComponents],
      connections: [
        ...this.base.connections.filter(
          (connection) => !this.removedConnectionIds.has(connection.id),
        ),
        ...this.addedConnections,
      ],
    };
  }

  /**
   * Moves each staged supply and ground wire to the board rail on the side its part
   * sits, when the board has an equivalent rail there.
   *
   * The model often wires GND before the signal, so at that moment nothing says
   * which side the part belongs on, and every ground landed on the first GND in
   * header order — a right-side LCD grounded across the board on GND-L. Rails of
   * one type and voltage are the same node, so the swap changes the drawing, not the
   * circuit. A part's side is where its own signal wires go; a part with none (an
   * LED behind its resistor) takes the side of the parts it is wired to. Wires that
   * already exist are left alone.
   */
  alignRails(): void {
    const state = this.state();
    const board = findBoard(state);
    const boardDefinition = board ? findDevice(board.definitionId) : undefined;
    if (!board || !boardDefinition) return;

    const isRail = (pinName: string) => {
      const pin = findPin(board.definitionId, pinName);
      return pin?.type === 'vcc' || pin?.type === 'gnd';
    };
    const tally = new Map<string, { left: number; right: number }>();
    const neighbours = new Map<string, Set<string>>();
    for (const connection of state.connections) {
      for (const [end, other] of [
        [connection.from, connection.to],
        [connection.to, connection.from],
      ] as const) {
        if (other.componentId === board.id) continue;
        if (end.componentId !== board.id) {
          const set = neighbours.get(other.componentId) ?? new Set<string>();
          set.add(end.componentId);
          neighbours.set(other.componentId, set);
          continue;
        }
        const side = findPin(board.definitionId, end.pinId)?.side;
        if (isRail(end.pinId) || (side !== 'left' && side !== 'right'))
          continue;
        const count = tally.get(other.componentId) ?? { left: 0, right: 0 };
        count[side]++;
        tally.set(other.componentId, count);
      }
    }

    const sideOf = (componentId: string): 'left' | 'right' | null => {
      const own = tally.get(componentId);
      const count = own ?? { left: 0, right: 0 };
      if (!own) {
        for (const neighbour of neighbours.get(componentId) ?? []) {
          const theirs = tally.get(neighbour);
          if (!theirs) continue;
          count.left += theirs.left;
          count.right += theirs.right;
        }
      }
      if (count.left === count.right) return null;
      return count.left > count.right ? 'left' : 'right';
    };

    const retarget = (
      endpoint: CircuitEndpoint,
      partId: string,
    ): CircuitEndpoint => {
      if (endpoint.componentId !== board.id || !isRail(endpoint.pinId))
        return endpoint;
      const pin = findPin(board.definitionId, endpoint.pinId);
      const side = sideOf(partId);
      if (!pin || !side || pin.side === side) return endpoint;
      const twin = boardDefinition.pins.find(
        (candidate) =>
          candidate.side === side &&
          candidate.type === pin.type &&
          candidate.voltage === pin.voltage &&
          candidate.multipleConnections !== false,
      );
      return twin ? { componentId: board.id, pinId: twin.name } : endpoint;
    };

    this.plan.forEach((action, index) => {
      if (action.type !== 'connect') return;
      const from = retarget(action.from, action.to.componentId);
      const to = retarget(action.to, action.from.componentId);
      if (from === action.from && to === action.to) return;
      const staged = this.addedConnections.findIndex(
        (connection) =>
          connection.from.componentId === action.from.componentId &&
          connection.from.pinId === action.from.pinId &&
          connection.to.componentId === action.to.componentId &&
          connection.to.pinId === action.to.pinId,
      );
      if (staged >= 0)
        this.addedConnections[staged] = {
          ...this.addedConnections[staged],
          from,
          to,
        };
      this.plan[index] = { ...action, from, to };
    });
  }

  /**
   * The staged actions. A dashboard change is one action, last, so the parts it binds
   * to are created before it is written.
   */
  actions(): readonly PlannedAction[] {
    const dashboard = this.dashboardDraft;
    if (!dashboard?.changed) return this.plan;
    return [
      ...this.plan,
      {
        type: 'set_dashboard',
        document: dashboard.result(),
        datastreams: dashboard.addedDatastreams(),
        baseVersion: dashboard.base.version,
      },
    ];
  }

  get isEmpty(): boolean {
    return this.actions().length === 0;
  }

  attachDashboard(base: DashboardDraft['base']): void {
    this.dashboardDraft = new DashboardDraft(
      base,
      (componentId) =>
        this.state().components.some(
          (component) => component.id === componentId,
        ),
      (componentId) => this.labelOf(componentId),
    );
  }

  /** Null when the dashboard is unavailable this turn. */
  dashboard(): DashboardDraft | null {
    return this.dashboardDraft;
  }

  board(): CircuitComponent | null {
    return findBoard(this.state());
  }

  /** Records that the assistant received this definition's full datasheet this turn. */
  markDatasheetReviewed(definitionId: string): void {
    this.reviewedDatasheets.add(definitionId);
  }

  /** Wiring tools use this as a hard gate instead of trusting a prompt instruction. */
  hasReviewedDatasheet(definitionId: string): boolean {
    return this.reviewedDatasheets.has(definitionId);
  }

  /**
   * Adds a part, or hands back the one already in the project.
   *
   * Reuse is the default and not an option the model may switch off, which is what stops
   * "add code for the DHT22" from producing a second DHT22 next to the one the user
   * placed. Genuinely wanting two is expressed by `allowDuplicate`, and the caller only
   * sets that when the user asked for another.
   */
  addDevice(
    definitionId: string,
    options: {
      label?: string;
      allowDuplicate?: boolean;
      settings?: DeviceSettings;
    } = {},
  ): { component: CircuitComponent; created: boolean } {
    const definition = findDevice(definitionId);
    if (!definition) {
      throw new WiringError(
        'DEFINITION_NOT_IN_CATALOG',
        `"${definitionId}" is not a part in the device catalog`,
      );
    }

    // A retry naming the same unit must not create it twice, even when the model
    // repeats allowDuplicate from the original multi-device request.
    const labelMatch =
      options.label?.trim() &&
      this.state().components.find(
        (component) =>
          component.definitionId === definitionId &&
          component.label === options.label?.trim(),
      );
    if (labelMatch) return { component: labelMatch, created: false };
    if (!options.allowDuplicate) {
      const existing = this.state().components.find(
        (component) => component.definitionId === definitionId,
      );
      if (existing) return { component: existing, created: false };
    }

    const ref = `${NEW_COMPONENT_PREFIX}${++this.sequence}`;
    const label = options.label?.trim() || definition.name;
    const component: CircuitComponent = { id: ref, definitionId, label };

    this.addedComponents.push(component);
    const settings = options.settings ?? {};
    this.plan.push({
      type: 'add_device',
      ref,
      definitionId,
      label,
      ...(Object.keys(settings).length ? { settings } : {}),
    });
    return { component, created: true };
  }

  /**
   * Stages new setting values for a part. A part this plan adds takes them on its own
   * add action, so the plan never creates a part and then immediately reconfigures it;
   * a part already in the project gets one configure action, merged across calls.
   */
  configure(componentId: string, settings: DeviceSettings): void {
    const index = this.plan.findIndex(
      (action) =>
        (action.type === 'add_device' && action.ref === componentId) ||
        (action.type === 'configure' && action.componentId === componentId),
    );
    const current = index >= 0 ? this.plan[index] : undefined;
    if (current?.type === 'add_device') {
      this.plan[index] = {
        ...current,
        settings: { ...current.settings, ...settings },
      };
    } else if (current?.type === 'configure') {
      this.plan[index] = {
        ...current,
        settings: { ...current.settings, ...settings },
      };
    } else {
      this.plan.push({ type: 'configure', componentId, settings });
    }
  }

  /**
   * Wires two pins, refusing anything the hardware rules reject.
   *
   * An already-existing wire is not an error: asking twice for the same connection is
   * what a model does when it re-reads its own work, and answering "already wired" lets it
   * carry on instead of retrying a refusal.
   */
  connect(
    from: CircuitEndpoint,
    to: CircuitEndpoint,
  ): {
    created: boolean;
    from: CircuitEndpoint;
    to: CircuitEndpoint;
    warnings: readonly WiringWarning[];
  } {
    try {
      const validated = validateConnection(this.state(), from, to);

      this.addedConnections.push({
        id: `${NEW_COMPONENT_PREFIX}wire-${++this.sequence}`,
        from: validated.from,
        to: validated.to,
        kind: validated.kind,
      });
      this.plan.push({
        type: 'connect',
        from: validated.from,
        to: validated.to,
        kind: validated.kind,
        color: validated.color,
      });

      return {
        created: true,
        from: validated.from,
        to: validated.to,
        warnings: validated.warnings,
      };
    } catch (error) {
      if (
        error instanceof WiringError &&
        error.code === 'CONNECTION_ALREADY_EXISTS'
      ) {
        return { created: false, from, to, warnings: [] };
      }
      throw error;
    }
  }

  /** Assigns a board pin for one peripheral pin and wires it in one step. */
  wireToBoard(
    peripheralId: string,
    peripheralPinId: string,
    preferredBoardPinId?: string,
  ): PinAssignment & { warnings: readonly WiringWarning[] } {
    const state = this.state();
    const board = findBoard(state);
    if (!board) {
      throw new WiringError(
        'NO_BOARD_IN_PROJECT',
        'This project has no development board to wire against',
      );
    }

    const peripheral = resolveComponent(state, peripheralId);
    const assignment = assignBoardPin(state, board, peripheral, {
      peripheralPinId,
      ...(preferredBoardPinId ? { preferredBoardPinId } : {}),
    });

    if (assignment.reused) return { ...assignment, warnings: [] };

    const result = this.connect(
      { componentId: peripheral.id, pinId: assignment.peripheralPin },
      { componentId: board.id, pinId: assignment.boardPin },
    );

    return { ...assignment, warnings: result.warnings };
  }

  disconnect(from: CircuitEndpoint, to: CircuitEndpoint): void {
    const state = this.state();
    const match = state.connections.find(
      (connection) =>
        (matches(connection.from, from) && matches(connection.to, to)) ||
        (matches(connection.from, to) && matches(connection.to, from)),
    );

    if (!match) {
      throw new WiringError(
        'CONNECTION_NOT_FOUND',
        'No wire connects those two pins',
      );
    }

    // A wire the plan itself created is withdrawn rather than scheduled for deletion:
    // there is nothing in the database to delete, and emitting one would fail at apply.
    const stagedIndex = this.addedConnections.findIndex(
      (connection) => connection.id === match.id,
    );
    if (stagedIndex >= 0) {
      const [staged] = this.addedConnections.splice(stagedIndex, 1);
      const planIndex = this.plan.findIndex(
        (action) =>
          action.type === 'connect' &&
          matches(action.from, staged.from) &&
          matches(action.to, staged.to),
      );
      if (planIndex >= 0) this.plan.splice(planIndex, 1);
      return;
    }

    this.removedConnectionIds.add(match.id);
    this.plan.push({
      type: 'disconnect',
      connectionId: match.id,
      summary: `${this.describe(match.from)} ↔ ${this.describe(match.to)}`,
    });
  }

  /** File content as the plan would leave it, or as it stands today. */
  readFile(path: string): DraftFile | null {
    const written = this.writtenFiles.get(path);
    if (written !== undefined) return { content: written, exists: true };
    return this.files.get(path) ?? null;
  }

  fileNames(): readonly string[] {
    return [
      ...new Set([...this.files.keys(), ...this.writtenFiles.keys()]),
    ].sort();
  }

  writeFile(path: string, content: string): { created: boolean } {
    const created = !this.files.has(path);
    this.writtenFiles.set(path, content);

    // One entry per path: a model that revises the same file twice in one turn should
    // produce one change to review, not two competing ones.
    const existing = this.plan.findIndex(
      (action) => action.type === 'write_file' && action.path === path,
    );
    const action: PlannedAction = {
      type: 'write_file',
      path,
      content,
      created,
    };
    if (existing >= 0) this.plan[existing] = action;
    else this.plan.push(action);

    return { created };
  }

  /** `Label:PIN`, the form every message and preview line uses. */
  describe(endpoint: CircuitEndpoint): string {
    const component = this.state().components.find(
      (item) => item.id === endpoint.componentId,
    );
    return `${component?.label ?? endpoint.componentId}:${endpoint.pinId}`;
  }

  /** Human name of a component, for previews that must not show a uuid. */
  labelOf(componentId: string): string {
    if (isPlaceholderRef(componentId)) {
      const staged = this.addedComponents.find(
        (item) => item.id === componentId,
      );
      if (staged) return staged.label;
    }
    return (
      this.state().components.find((item) => item.id === componentId)?.label ??
      componentId
    );
  }

  /** True when the definition behind a component has a pinout the API can reason about. */
  isDescribable(component: CircuitComponent): boolean {
    try {
      resolveDefinition(component);
      return true;
    } catch {
      return false;
    }
  }
}

function matches(a: CircuitEndpoint, b: CircuitEndpoint): boolean {
  return (
    a.componentId === b.componentId &&
    a.pinId.toUpperCase() === b.pinId.toUpperCase()
  );
}
