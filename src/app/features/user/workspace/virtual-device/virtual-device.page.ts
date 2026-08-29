import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { ProjectStore } from '../../projects/project.store';
import { AddDeviceModal } from './add-device-modal/add-device-modal';
import { DeviceArt } from './device-art/device-art';
import { DeviceKind } from './device-library.models';
import { defaultStateFor, type DevicePropertyDefinition } from './devices/core/device-definition';
import type { DetailLevel } from './devices/core/device-shape';
import { DEVICES, DEVICE_LIBRARY_ITEMS, deviceById } from './devices/device-catalog';
import { drawingScaleFor } from './devices/core/device-metrics';
import {
  orthogonalPath,
  routeWire,
  type Obstacle,
  type PinSide as RouterPinSide,
} from './simulation/wire-router';
import {
  ProjectCanvasService,
  asComponentLimitRefusal,
  asConnectionLimitRefusal,
  type CanvasConnection,
} from './services/project-canvas.service';
import {
  BOARD_PINS,
  INITIAL_CONNECTIONS,
  WIRE_COLORS,
} from './devices/microcontrollers/esp32-devkit.board';
import { relayChannelBox } from './devices/relay/relay-module.device';
import type {
  BoardPin,
  ConnectionKind,
  DevicePin,
  DevicePlacement,
  Point,
  VirtualDevice,
  WireConnection,
  WireEndpoint,
  WireWaypoint,
} from './models/virtual-device.model';
import type { DeviceBehavior } from './devices/core/device-simulation';
import { isPassivePinType } from './devices/core/device-types';
import { DevicePreferenceService } from './services/device-preference.service';
import { devicePinKey, simulateTick, type SimulationResult } from './simulation/circuit-simulator';
import { SEVERITY_LABELS, validateCircuit, type WireIssue } from './simulation/wire-validation';

interface DragState {
  deviceId: string;
  pointerId: number;
  offset: Point;
}

interface BoardDragState {
  pointerId: number;
  offset: Point;
}

interface WireCurveDragState {
  pointerId: number;
  wireId: string;
  waypointIndex: number;
}

interface WireGeometry {
  source: Point;
  sourceControl: Point;
  targetControl: Point;
  target: Point;
}

interface WireControlHandle extends Point {
  readonly waypointIndex: number;
  readonly trackId: string;
  readonly label: string;
}

interface WireJunction extends Point {
  readonly id: string;
  readonly kind: ConnectionKind;
}

interface PanState {
  pointerId: number;
  startClient: Point;
  origin: Point;
  moved: boolean;
}

interface DeviceInstance extends VirtualDevice {
  readonly instanceId: string;
}

type DeviceState = Readonly<Record<string, string | number | boolean>>;

/** Shared empty state so parts without properties never allocate per render. */
const EMPTY_STATE: DeviceState = Object.freeze({});

/** Result used whenever the simulation is stopped. */
const EMPTY_SIMULATION: SimulationResult = Object.freeze({
  runtime: {},
  pinStates: new Map(),
  shorts: [],
});

/** Diagram coordinate system. The SVG is 1:1 with CSS pixels before transform. */
const BASE_CANVAS_SCALE = 0.6;
const GRID_SIZE = 25;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
/** Simulation tick interval. 20 Hz is ample for the parts in this catalog. */
const SIMULATION_TICK_MS = 50;

const INITIAL_DEVICE_INSTANCES: readonly DeviceInstance[] = DEVICES.map((device) => ({
  ...device,
  instanceId: device.id,
}));

const INITIAL_PLACEMENTS = Object.fromEntries(
  DEVICES.map((device) => [
    device.id,
    { x: device.x, y: device.y, rotation: 0, visible: device.initiallyVisible !== false },
  ]),
) as Record<string, DevicePlacement>;

/** Property defaults for the parts placed in a fresh workspace. */
const INITIAL_DEVICE_STATES: Readonly<Record<string, DeviceState>> = Object.fromEntries(
  DEVICES.filter((device) => device.properties?.length).map((device) => [
    device.id,
    defaultStateFor(device.properties),
  ]),
);

const INITIAL_RELAY_STATES: Readonly<Record<string, readonly boolean[]>> = {
  relay: [false],
  relay2: [false, false],
  relay4: [false, false, false, false],
  relay8: [false, false, false, false, false, false, false, false],
};

@Component({
  selector: 'app-virtual-device-page',
  imports: [AddDeviceModal, DeviceArt],
  templateUrl: './virtual-device.page.html',
  styleUrls: [
    './virtual-device.page.css',
    './virtual-device.devices.css',
    './device-inspector.css',
  ],
  host: {
    '(window:pointermove)': 'continueDeviceDrag($event)',
    '(window:pointerup)': 'finishDeviceDrag($event)',
    '(window:keydown)': 'handleEditorKeydown($event)',
  },
})
export class VirtualDevicePage {
  private readonly route = inject(ActivatedRoute);
  private readonly canvasPersistence = inject(ProjectCanvasService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly projectStore = inject(ProjectStore);
  private readonly preferences = inject(DevicePreferenceService);
  private readonly canvasSvg = viewChild<ElementRef<SVGSVGElement>>('canvasSvg');
  private readonly canvasViewport = viewChild<ElementRef<HTMLElement>>('canvasViewport');
  private readonly addPartTrigger = viewChild<ElementRef<HTMLButtonElement>>('addPartTrigger');
  private dragState: DragState | null = null;
  private boardDragState: BoardDragState | null = null;
  private wireCurveDragState: WireCurveDragState | null = null;
  private panState: PanState | null = null;
  private partsOpener: HTMLButtonElement | null = null;
  private wireSequence = INITIAL_CONNECTIONS.length;
  private junctionSequence = 0;
  private deviceSequence = 0;
  private placementQueue: DeviceKind[] = [];
  private frameRequest = 0;
  private frameAction: (() => void) | null = null;

  protected readonly deviceInstances = signal<readonly DeviceInstance[]>([
    ...INITIAL_DEVICE_INSTANCES,
  ]);
  protected readonly libraryDevices = DEVICE_LIBRARY_ITEMS;
  protected readonly boardPins = BOARD_PINS;
  protected readonly wireColors = WIRE_COLORS;
  protected readonly placements = signal<Record<string, DevicePlacement>>({
    ...INITIAL_PLACEMENTS,
  });
  protected readonly connections = signal<readonly WireConnection[]>([...INITIAL_CONNECTIONS]);
  protected readonly selectedDeviceId = signal<string | null>(null);
  protected readonly boardSelected = signal(false);
  protected readonly selectedWireId = signal<string | null>(null);
  protected readonly pendingPin = signal<WireEndpoint | null>(null);
  protected readonly wirePointer = signal<Point | null>(null);
  protected readonly pendingWireWaypoints = signal<readonly Point[]>([]);
  protected readonly wireJunctions = signal<Readonly<Record<string, WireJunction>>>({});
  protected readonly simulationRunning = signal(false);
  protected readonly showGrid = signal(true);
  protected readonly partsOpen = signal(false);
  protected readonly favoriteDeviceIds = this.preferences.favorites;
  protected readonly recentDeviceIds = this.preferences.recents;
  protected readonly serialOpen = signal(false);
  protected readonly inspectorOpen = signal(false);
  protected readonly openPropertyDropdownId = signal<string | null>(null);
  protected readonly zoom = signal(1);
  protected readonly canvasPan = signal<Point>({ x: 0, y: 0 });
  protected readonly boardPosition = signal<Point>({ x: 0, y: 0 });
  protected readonly panning = signal(false);
  protected readonly buttonPressedStates = signal<Readonly<Record<string, boolean>>>({});
  protected readonly canZoomOut = computed(() => this.zoom() > MIN_ZOOM);
  protected readonly canZoomIn = computed(() => this.zoom() < MAX_ZOOM);
  protected readonly canvasDeviceDetail = computed<DetailLevel>(() =>
    this.zoom() < 0.85 ? 'low' : 'normal',
  );

  /** Part waiting to be dropped on the canvas, and where its ghost currently sits. */
  protected readonly placingDeviceId = signal<DeviceKind | null>(null);
  /** Shown when a saved layout could not be fetched, so a stale view is not silent. */
  protected readonly layoutLoadFailed = signal(false);
  /**
   * True once this project's own components have been loaded.
   *
   * The canvas ships with a fixed demo board for the standalone experience; a
   * real project brings its own, so the demo one is hidden rather than drawn
   * alongside it.
   */
  protected readonly usesPersistedLayout = signal(false);
  /** True while this project's saved layout is still being fetched. */
  protected readonly layoutLoading = signal(false);
  /** Plan refusal from the server, shown instead of the device silently vanishing. */
  protected readonly componentLimitMessage = signal<string | null>(null);
  /** Live plan usage for this project, refreshed after the layout is written. */
  protected readonly projectUsage = signal<
    readonly { label: string; used: number; limit: number; unlimited: boolean }[]
  >([]);
  /**
   * Wire-edit mode.
   *
   * Off by default so wires are purely visual and can never intercept a click
   * meant for a device — the one rule the canvas must not break. Turning it on
   * makes wires selectable and their bend points draggable.
   */
  protected readonly wireEditing = signal(false);

  protected toggleWireEditing(): void {
    const next = !this.wireEditing();
    this.wireEditing.set(next);
    // Leaving the mode drops any wire selection, so the inspector does not keep
    // showing a wire the user can no longer click.
    if (!next) this.selectedWireId.set(null);
  }
  protected readonly ghostPoint = signal<Point | null>(null);

  /**
   * Per-instance property values for parts on the declarative pipeline, keyed by
   * instance id then property id. Held separately from `placements` so editing a
   * value never invalidates geometry, and vice versa.
   */
  protected readonly deviceStates =
    signal<Readonly<Record<string, DeviceState>>>(INITIAL_DEVICE_STATES);

  protected readonly selectedProperties = computed<readonly DevicePropertyDefinition[]>(
    () => this.selectedDevice()?.properties ?? [],
  );

  /**
   * The circuit solve.
   *
   * Modelled as a `computed` rather than an animation loop because every
   * behaviour currently derives its output from the netlist and the property
   * values alone. That means the simulation re-solves exactly when the circuit
   * changes — placing a part, moving a wire, pressing a button — instead of
   * burning a frame budget re-rendering 100 unchanged devices at 60 Hz.
   *
   * Adding a time-dependent part (a PIR retrigger timer, servo slew) will need
   * a persistent behaviour map plus a ticker; the `DeviceBehavior` factory
   * contract is already shaped for that.
   */
  protected readonly simulation = signal<SimulationResult>(EMPTY_SIMULATION);

  /**
   * Behaviour instances, kept alive across ticks.
   *
   * They must persist: a PIR's retrigger countdown and a servo's slew live
   * inside the behaviour, so rebuilding them every tick would freeze both at
   * their initial state. The map is synced against the placed devices instead.
   */
  private readonly behaviors = new Map<string, DeviceBehavior>();
  private tickHandle = 0;
  private lastTickAt = 0;

  /** Re-solves immediately whenever the circuit itself changes. */
  private readonly circuitEffect = effect(() => {
    const running = this.simulationRunning();
    // Track the inputs a solve depends on so edits apply without waiting for
    // the next tick.
    this.visibleDevices();
    this.visibleConnections();
    this.deviceStates();

    if (!running) return;
    untracked(() => this.solveCircuit(0));
  });

  private solveCircuit(deltaMs: number): void {
    const states = this.deviceStates();
    const devices = this.visibleDevices().map((device) => ({
      instanceId: device.instanceId,
      definition: device,
      properties: states[device.instanceId] ?? EMPTY_STATE,
    }));

    this.syncBehaviors(devices);
    this.simulation.set(
      simulateTick(
        {
          devices,
          connections: this.visibleConnections(),
          boardPins: this.boardPins,
          deltaMs,
        },
        this.behaviors,
      ),
    );
  }

  /** Creates behaviours for new parts and drops them for removed ones. */
  private syncBehaviors(
    devices: readonly { instanceId: string; definition: VirtualDevice }[],
  ): void {
    const live = new Set<string>();
    for (const device of devices) {
      live.add(device.instanceId);
      if (this.behaviors.has(device.instanceId)) continue;
      const factory = device.definition.simulation;
      if (factory) this.behaviors.set(device.instanceId, factory());
    }
    for (const instanceId of [...this.behaviors.keys()]) {
      if (!live.has(instanceId)) this.behaviors.delete(instanceId);
    }
  }

  /**
   * Drives time-dependent parts. Runs at roughly 20 Hz rather than every frame:
   * nothing in the catalog animates faster than that, and a lower rate keeps
   * large diagrams from re-rendering 60 times a second.
   */
  private startTicker(): void {
    if (this.tickHandle) return;
    this.lastTickAt = performance.now();
    const step = () => {
      this.tickHandle = requestAnimationFrame(step);
      const now = performance.now();
      const elapsed = now - this.lastTickAt;
      if (elapsed < SIMULATION_TICK_MS) return;
      this.lastTickAt = now;
      this.solveCircuit(elapsed);
    };
    this.tickHandle = requestAnimationFrame(step);
  }

  private stopTicker(): void {
    if (this.tickHandle) cancelAnimationFrame(this.tickHandle);
    this.tickHandle = 0;
    for (const behavior of this.behaviors.values()) behavior.reset?.();
    this.behaviors.clear();
    this.simulation.set(EMPTY_SIMULATION);
  }

  /** Short circuits found by the last solve, surfaced in the inspector. */
  protected readonly simulationShorts = computed(() => this.simulation().shorts);

  /** Findings the user has chosen to accept; kept out of the list below. */
  private readonly dismissedIssueIds = signal<ReadonlySet<string>>(new Set());

  private readonly allIssues = computed(() =>
    validateCircuit({
      devices: this.visibleDevices().map((device) => ({
        instanceId: device.instanceId,
        definition: device,
      })),
      connections: this.visibleConnections(),
      boardPins: this.boardPins,
    }),
  );

  /**
   * Shorts the solver found while running.
   *
   * These are deliberately separate from the static checks: a supply pin cannot
   * be wired straight to a ground pin (the wiring rules reject it), so the only
   * way to short a rail is *dynamically* — closing a switch that bridges two
   * rails, for instance. Only the solver, which applies switch bonds, can see
   * that, so the static pass would never catch it.
   */
  private readonly shortIssues = computed<readonly WireIssue[]>(() => {
    const result = this.simulation();
    if (!result.shorts.length) return [];

    const owners = new Map<string, string[]>();
    for (const device of this.visibleDevices()) {
      for (const devicePin of device.pins) {
        const node = result.pinStates.get(devicePinKey(device.instanceId, devicePin.name));
        if (!node?.conflict) continue;
        const bucket = owners.get(device.instanceId);
        if (bucket) bucket.push(devicePin.name);
        else owners.set(device.instanceId, [devicePin.name]);
      }
    }

    return [...owners].map(([instanceId, pinNames]) => ({
      id: `short:${instanceId}:${pinNames.join('-')}`,
      code: 'live-short',
      severity: 'error' as const,
      title: 'ตรวจพบไฟลัดขณะจำลอง',
      detail: `ขา ${pinNames.join(', ')} อยู่บนจุดที่มีทั้งไฟเลี้ยงและกราวด์จ่ายพร้อมกัน ถ้าเป็นวงจรจริงจะเกิดกระแสลัดวงจร`,
      deviceIds: [instanceId],
      wireIds: [],
    }));
  });

  protected readonly wireIssues = computed(() => {
    const dismissed = this.dismissedIssueIds();
    return [...this.allIssues(), ...this.shortIssues()].filter((issue) => !dismissed.has(issue.id));
  });

  /** Findings that touch the selected part, shown in its inspector. */
  protected readonly selectedDeviceIssues = computed(() => {
    const id = this.selectedDeviceId();
    if (!id) return [];
    return this.wireIssues().filter((issue) => issue.deviceIds.includes(id));
  });

  protected readonly issueSeverityLabels = SEVERITY_LABELS;
  protected readonly issueDockOpen = signal(false);

  /** Counts by severity, so the dock says what kind of problem it found. */
  protected readonly issueSummary = computed(() => {
    const issues = this.wireIssues();
    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.length - errors;
    if (errors && warnings) return `พบข้อผิดพลาด ${errors} และคำเตือน ${warnings}`;
    if (errors) return `พบข้อผิดพลาด ${errors} รายการ`;
    return `พบคำเตือน ${warnings} รายการ`;
  });

  /** Wires and parts named by an open finding, for the canvas highlight. */
  private readonly flaggedTargets = computed(() => {
    const wires = new Set<string>();
    const devices = new Set<string>();
    for (const issue of this.wireIssues()) {
      for (const wireId of issue.wireIds) wires.add(wireId);
      for (const deviceId of issue.deviceIds) devices.add(deviceId);
    }
    return { wires, devices };
  });

  protected wireFlagged(wireId: string): boolean {
    return this.flaggedTargets().wires.has(wireId);
  }

  protected deviceFlagged(instanceId: string): boolean {
    return this.flaggedTargets().devices.has(instanceId);
  }

  protected toggleIssueDock(): void {
    this.issueDockOpen.update((open) => !open);
  }

  /** Selects whatever a finding is about so the inspector can explain it. */
  protected focusIssue(issue: WireIssue): void {
    const deviceId = issue.deviceIds[0];
    if (deviceId) {
      this.selectDevice(deviceId);
      return;
    }
    this.revealIssue(issue);
  }

  protected dismissIssue(id: string): void {
    this.dismissedIssueIds.update((dismissed) => new Set([...dismissed, id]));
  }

  protected restoreDismissedIssues(): void {
    this.dismissedIssueIds.set(new Set());
  }

  protected readonly dismissedIssueCount = computed(
    () => this.allIssues().length - this.wireIssues().length,
  );

  /** Focuses the first wire a finding refers to, so it can be inspected. */
  protected revealIssue(issue: WireIssue): void {
    const wireId = issue.wireIds[0];
    if (!wireId) return;
    this.selectedWireId.set(wireId);
    this.selectedDeviceId.set(null);
    this.boardSelected.set(false);
    this.inspectorOpen.set(true);
  }

  protected readonly relayChannelStates =
    signal<Readonly<Record<string, readonly boolean[]>>>(INITIAL_RELAY_STATES);
  protected readonly relayOn = computed(() =>
    Object.values(this.relayChannelStates()).some((states) => states?.some(Boolean)),
  );
  protected readonly servoAngle = signal(90);
  protected readonly distance = signal(42);

  protected readonly project = computed(() =>
    this.projectStore.projectById(this.route.snapshot.paramMap.get('projectId')),
  );
  protected readonly visibleDevices = computed(() =>
    this.deviceInstances().filter((device) => this.placements()[device.instanceId]?.visible),
  );
  /**
   * True only once the project's layout has settled and it really is empty.
   *
   * Without the loading term the empty state flashed on every refresh of a
   * project that has devices: the canvas is cleared before the fetch, so it
   * looked empty for as long as the round trip took, then filled in.
   */
  protected readonly canvasEmpty = computed(
    () =>
      !this.layoutLoading() &&
      this.visibleDevices().length === 0 &&
      !this.placingDeviceId(),
  );
  protected readonly visibleConnections = computed(() =>
    this.connections().filter(
      (wire) => this.endpointVisible(wire.start) && this.endpointVisible(wire.end),
    ),
  );
  protected readonly selectedDevice = computed(
    () =>
      this.deviceInstances().find((device) => device.instanceId === this.selectedDeviceId()) ??
      null,
  );
  protected readonly selectedWire = computed(
    () => this.connections().find((wire) => wire.id === this.selectedWireId()) ?? null,
  );
  protected readonly junctionPoints = computed(() => Object.values(this.wireJunctions()));
  protected readonly selectedConnections = computed(() => {
    const id = this.selectedDeviceId();
    return id
      ? this.connections().filter((connection) => this.connectionHasDevice(connection, id))
      : [];
  });
  protected readonly placingDevice = computed(() => {
    const id = this.placingDeviceId();
    return id ? (deviceById(id) ?? null) : null;
  });
  protected readonly canvasScale = computed(() => BASE_CANVAS_SCALE * this.zoom());

  private readonly gridLayers = computed(() => {
    const scale = this.canvasScale();
    const pan = this.canvasPan();
    const spacing = GRID_SIZE * scale;

    return [
      {
        image: 'radial-gradient(circle, #b8bec5 1px, transparent 1.2px)',
        size: `${spacing}px ${spacing}px`,
        position: `${pan.x - spacing / 2}px ${pan.y - spacing / 2}px`,
      },
    ];
  });

  protected readonly gridImage = computed(() =>
    this.showGrid()
      ? this.gridLayers()
          .map((layer) => layer.image)
          .join(', ')
      : 'none',
  );
  protected readonly gridSize = computed(() =>
    this.gridLayers()
      .map((layer) => layer.size)
      .join(', '),
  );
  protected readonly gridPosition = computed(() =>
    this.gridLayers()
      .map((layer) => layer.position)
      .join(', '),
  );

  protected readonly activeReading = computed(() => {
    const device = this.selectedDevice();
    if (!device) return 'No part selected';

    // Parts on the declarative pipeline report from their runtime state rather
    // than needing a case added to the legacy switch below.
    if (device.render) return this.liveReadingFor(device);

    switch (device.id) {
      case 'lcd':
      case 'lcd1602parallel':
      case 'lcd2004parallel':
      case 'lcd2004i2c':
        return this.simulationRunning() ? `${this.distance()} cm` : 'Standby';
      case 'led':
        return this.simulationRunning() ? 'On' : 'Off';
      case 'ultrasonic':
        return `${this.distance()} cm`;
      case 'relay':
      case 'relay2':
      case 'relay4':
      case 'relay8':
        return this.relayOn() ? 'Energized' : 'Open';
      case 'button':
        return this.buttonPressedFor(this.selectedDeviceId()) ? 'Pressed' : 'Released';
      case 'servo':
        return `${this.servoAngle()} deg`;
      case 'dc-motor':
        return this.simulationRunning() ? 'Running' : 'Stopped';
      default:
        return 'No part selected';
    }
  });

  /** Route project id. Null only if the canvas is opened outside a project. */
  private readonly persistedProjectId =
    this.route.snapshot.paramMap.get('projectId') ??
    this.route.parent?.snapshot.paramMap.get('projectId') ??
    null;

  constructor() {
    afterNextRender(() => this.centerCanvasAtZoom(1));

    // Inside a project the canvas shows that project and nothing else. The
    // starter circuit — board, LCD, servo — is demo content for the standalone
    // experience, and it must never appear in a user's real project, including
    // during the moment before the saved layout arrives.
    if (this.persistedProjectId) {
      this.usesPersistedLayout.set(true);
      this.layoutLoading.set(true);
      this.deviceInstances.set([]);
      this.placements.set({});
      this.connections.set([]);
      this.deviceStates.set({});
      this.relayChannelStates.set({});
    }

    void this.restorePersistedComponents();

    // A drag in progress when the user navigates away would otherwise be lost:
    // its write is still sitting in the debounce window.
    this.destroyRef.onDestroy(() => {
      const projectId = this.persistedProjectId;
      if (projectId) void this.canvasPersistence.flushAll(projectId);
    });
  }

  /**
   * Replaces the starter layout with whatever this project actually contains.
   *
   * A project created with a board already has that board stored, so it appears
   * here rather than the canvas opening empty after the user chose one.
   */
  private async restorePersistedComponents(): Promise<void> {
    const projectId = this.persistedProjectId;
    if (!projectId) return;

    try {
      const stored = await this.canvasPersistence.load(projectId);

      const instances: DeviceInstance[] = [];
      const placements: Record<string, DevicePlacement> = {};
      const states: Record<string, DeviceState> = {};

      for (const component of stored) {
        const definition = deviceById(component.definitionId);
        // A component whose definition is not in this build is skipped rather
        // than crashing the canvas; it stays in the database untouched.
        if (!definition) continue;

        instances.push({ ...definition, instanceId: component.id });
        placements[component.id] = {
          x: component.x,
          y: component.y,
          rotation: component.rotation,
          visible: true,
        };
        if (definition.properties?.length) {
          states[component.id] = {
            ...defaultStateFor(definition.properties),
            ...(component.state as DeviceState),
          };
        }
      }

      void this.refreshUsage();
      this.deviceInstances.set(instances);
      this.placements.set(placements);
      this.deviceStates.set(states);
      await this.restorePersistedConnections(projectId, new Set(Object.keys(placements)));
    } catch {
      this.layoutLoadFailed.set(true);
    } finally {
      this.layoutLoading.set(false);
    }
  }

  // ---------------------------------------------------------------- geometry

  protected placementFor(id: string): DevicePlacement {
    return this.placements()[id];
  }

  /**
   * Scale that maps this part's drawing units onto the shared physical scale.
   *
   * The same factor is applied to the artwork here and to pin coordinates in
   * devicePinPoint. Scaling one without the other would drift the visible pin
   * away from the point a wire attaches to.
   */
  protected renderScale(device: DeviceInstance): number {
    return drawingScaleFor(device);
  }

  protected deviceTransform(device: DeviceInstance): string {
    const placement = this.placementFor(device.instanceId);
    const scale = this.renderScale(device);
    // Order matters: rotate about the body centre in drawing units, then scale,
    // then position. devicePinPoint composes the same operations.
    return `translate(${placement.x} ${placement.y}) scale(${scale}) rotate(${placement.rotation} ${
      device.width / 2
    } ${device.height / 2})`;
  }

  /** Keeps the selection label upright no matter how the part is rotated. */
  protected labelTransform(device: DeviceInstance): string {
    return `rotate(${-this.placementFor(device.instanceId).rotation} ${device.width / 2} -22)`;
  }

  protected boardTransform(): string {
    const position = this.boardPosition();
    return `translate(${position.x} ${position.y})`;
  }

  protected canvasTransform(): string {
    const pan = this.canvasPan();
    return `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${this.canvasScale()})`;
  }

  protected relayStatesFor(id: string): readonly boolean[] {
    return this.relayChannelStates()[id] ?? [];
  }

  // ------------------------------------------------------- device properties

  /**
   * Property values for one instance, with any simulation output layered on
   * top. The artwork therefore draws configured values while stopped and live
   * values while running, from a single input.
   */
  /**
   * One-line status for a part on the declarative pipeline.
   *
   * Prefers whatever the simulation published, then the part's own headline
   * property, so a new device gets a sensible readout without this method
   * growing a case for it.
   */
  private liveReadingFor(device: DeviceInstance): string {
    const state = this.deviceStateFor(device.instanceId);

    if (typeof state['brightness'] === 'number') {
      return state['brightness'] > 0 ? `On · ${state['brightness']}%` : 'Off';
    }
    if (typeof state['closed'] === 'boolean') return state['closed'] ? 'Closed' : 'Open';
    if (typeof state['sounding'] === 'boolean') return state['sounding'] ? 'Sounding' : 'Silent';
    if (typeof state['motion'] === 'boolean') return state['motion'] ? 'Motion' : 'Clear';

    const headline = device.properties?.[0];
    if (headline) {
      const value = state[headline.id];
      if (value !== undefined && typeof value !== 'boolean') {
        return `${value}${headline.unit ? ` ${headline.unit}` : ''}`;
      }
    }
    return this.simulationRunning() ? 'Running' : 'Idle';
  }

  protected deviceStateFor(instanceId: string): DeviceState {
    const properties = this.deviceStates()[instanceId] ?? EMPTY_STATE;
    const runtime = this.simulation().runtime[instanceId];
    return runtime ? { ...properties, ...runtime } : properties;
  }

  protected propertyValue(property: DevicePropertyDefinition): string | number | boolean {
    const id = this.selectedDeviceId();
    const current = id ? this.deviceStates()[id]?.[property.id] : undefined;
    return current ?? property.defaultValue;
  }

  protected propertyNumber(property: DevicePropertyDefinition): number {
    const value = this.propertyValue(property);
    return typeof value === 'number' ? value : Number(value) || 0;
  }

  protected propertyChecked(property: DevicePropertyDefinition): boolean {
    return this.propertyValue(property) === true;
  }

  protected propertyText(property: DevicePropertyDefinition): string {
    return String(this.propertyValue(property));
  }

  protected propertyOptionLabel(property: DevicePropertyDefinition): string {
    const value = this.propertyText(property);
    return property.options?.find((option) => option.value === value)?.label ?? value;
  }

  protected propertyColorSwatch(value: string): string | null {
    const colors: Readonly<Record<string, string>> = {
      red: '#ef4444',
      green: '#22c55e',
      blue: '#3b82f6',
      yellow: '#facc15',
      white: '#f8fafc',
      orange: '#f97316',
    };
    return colors[value] ?? null;
  }

  protected togglePropertyDropdown(propertyId: string): void {
    this.openPropertyDropdownId.update((openId) => (openId === propertyId ? null : propertyId));
  }

  protected openPropertyDropdownFromKeyboard(event: Event, propertyId: string): void {
    event.preventDefault();
    this.openPropertyDropdownId.set(propertyId);
  }

  protected closePropertyDropdownOnEscape(event: Event): void {
    event.preventDefault();
    this.openPropertyDropdownId.set(null);
    const dropdown = event.currentTarget as HTMLElement;
    dropdown.querySelector<HTMLButtonElement>('.property-select-trigger')?.focus();
  }

  protected closePropertyDropdownOnFocusOut(event: FocusEvent, propertyId: string): void {
    const dropdown = event.currentTarget as HTMLElement;
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && dropdown.contains(nextTarget)) return;
    if (this.openPropertyDropdownId() === propertyId) this.openPropertyDropdownId.set(null);
  }

  protected choosePropertyOption(property: DevicePropertyDefinition, value: string): void {
    this.updateSelectProperty(property, value);
    this.openPropertyDropdownId.set(null);
  }

  /** Simulation-only knobs are inert until the workspace is running. */
  protected propertyDisabled(property: DevicePropertyDefinition): boolean {
    return Boolean(property.simulationOnly) && !this.simulationRunning();
  }

  protected updateNumberProperty(property: DevicePropertyDefinition, event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(raw)) return;
    const clamped = Math.min(
      property.max ?? Number.POSITIVE_INFINITY,
      Math.max(property.min ?? Number.NEGATIVE_INFINITY, raw),
    );
    this.setDeviceProperty(property.id, clamped);
  }

  protected updateBooleanProperty(property: DevicePropertyDefinition, event: Event): void {
    this.setDeviceProperty(property.id, (event.target as HTMLInputElement).checked);
  }

  protected updateTextProperty(property: DevicePropertyDefinition, event: Event): void {
    this.setDeviceProperty(property.id, (event.target as HTMLInputElement).value);
  }

  protected updateSelectProperty(property: DevicePropertyDefinition, value: string): void {
    this.setDeviceProperty(property.id, value);
  }

  /** Restores every property on the selected part to its catalog default. */
  protected resetDeviceProperties(): void {
    const id = this.selectedDeviceId();
    const device = this.selectedDevice();
    if (!id || !device) return;
    this.deviceStates.update((states) => ({
      ...states,
      [id]: defaultStateFor(device.properties),
    }));
  }

  private setDeviceProperty(propertyId: string, value: string | number | boolean): void {
    const id = this.selectedDeviceId();
    const device = this.selectedDevice();
    if (!id || !device) return;
    this.deviceStates.update((states) => ({
      ...states,
      [id]: { ...(states[id] ?? defaultStateFor(device.properties)), [propertyId]: value },
    }));
  }

  /** Hit target for one relay block, matching the drawn artwork exactly. */
  protected relayBox(device: VirtualDevice, index: number) {
    return relayChannelBox(device.relayChannels?.length ?? 1, index);
  }

  // --------------------------------------------------------------- selection

  protected selectDevice(id: string): void {
    this.openPropertyDropdownId.set(null);
    this.selectedDeviceId.set(id);
    this.boardSelected.set(false);
    this.selectedWireId.set(null);
    this.inspectorOpen.set(true);
  }

  protected selectBoard(): void {
    this.openPropertyDropdownId.set(null);
    this.selectedDeviceId.set(null);
    this.boardSelected.set(true);
    this.selectedWireId.set(null);
  }

  protected selectWire(event: Event, id: string): void {
    event.stopPropagation();
    this.openPropertyDropdownId.set(null);
    this.selectedWireId.set(id);
    this.selectedDeviceId.set(null);
    this.boardSelected.set(false);
    this.inspectorOpen.set(true);
  }

  protected handleWirePointerDown(event: PointerEvent, wireId: string): void {
    if (this.pendingPin()) this.connectPendingWireToWire(event, wireId);
    else this.selectWire(event, wireId);
  }

  protected selectJunction(event: Event, junctionId: string): void {
    this.selectWireEndpoint(event, { type: 'junction', junctionId });
  }

  protected clearSelection(): void {
    this.openPropertyDropdownId.set(null);
    this.selectedDeviceId.set(null);
    this.boardSelected.set(false);
    this.selectedWireId.set(null);
    this.inspectorOpen.set(false);
  }

  // ------------------------------------------------------- canvas pan & zoom

  protected beginCanvasPan(event: PointerEvent): void {
    const viewport = event.currentTarget as HTMLElement;
    if (event.button === 0 || event.button === 1) viewport.focus({ preventScroll: true });
    if (event.button !== 0 && event.button !== 1) return;

    if (event.button === 0 && this.placingDeviceId()) {
      this.dropPlacement(event);
      return;
    }

    if (event.button === 0 && this.pendingPin()) {
      const point = this.svgPoint(event);
      if (point) {
        const previous =
          this.pendingWireWaypoints().at(-1) ?? this.endpointPoint(this.pendingPin()!);
        if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 8) {
          this.pendingWireWaypoints.update((waypoints) => [...waypoints, point]);
          this.wirePointer.set(point);
        }
      }
      event.preventDefault();
      return;
    }

    event.preventDefault();
    this.panState = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      origin: { ...this.canvasPan() },
      moved: false,
    };
    this.panning.set(true);
    viewport.setPointerCapture(event.pointerId);
  }

  protected handleCanvasPointerMove(event: PointerEvent): void {
    const client = { x: event.clientX, y: event.clientY };

    if (this.pendingPin()) {
      this.scheduleFrame(() => {
        const point = this.svgPointFromClient(client);
        if (point) this.wirePointer.set(point);
      });
      return;
    }

    if (!this.placingDeviceId()) return;
    const device = this.placingDevice();
    if (!device) return;
    this.scheduleFrame(() => {
      const point = this.svgPointFromClient(client);
      if (!point) return;
      this.ghostPoint.set(
        this.snapPoint({ x: point.x - device.width / 2, y: point.y - device.height / 2 }),
      );
    });
  }

  protected handleCanvasWheel(event: WheelEvent): void {
    if (event.deltaX === 0 && event.deltaY === 0) return;
    event.preventDefault();
    event.stopPropagation();

    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();

    if (event.ctrlKey || event.metaKey) {
      const direction = event.deltaY < 0 ? 1 : -1;
      this.zoomAround(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        this.normalizedZoom(this.zoom() + direction * ZOOM_STEP),
      );
      return;
    }

    const deltaX = event.shiftKey ? event.deltaY : event.deltaX;
    const deltaY = event.shiftKey ? 0 : event.deltaY;
    this.canvasPan.update((pan) => ({ x: pan.x - deltaX, y: pan.y - deltaY }));
  }

  protected handleCanvasZoomKeydown(event: KeyboardEvent): void {
    if (!event.ctrlKey) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      event.stopPropagation();
      this.zoomIn();
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      event.stopPropagation();
      this.zoomOut();
    }
  }

  protected zoomIn(): void {
    this.zoomAtViewportCenter(this.normalizedZoom(this.zoom() + ZOOM_STEP));
  }

  protected zoomOut(): void {
    this.zoomAtViewportCenter(this.normalizedZoom(this.zoom() - ZOOM_STEP));
  }

  /** Frames the board and every placed part inside the viewport. */
  protected fitCanvas(): void {
    const viewport = this.canvasViewport()?.nativeElement;
    if (!viewport) {
      this.zoom.set(1);
      this.canvasPan.set({ x: 0, y: 0 });
      return;
    }
    const bounds = viewport.getBoundingClientRect();
    const content = this.contentBounds();
    const width = Math.max(content.maxX - content.minX, 1);
    const height = Math.max(content.maxY - content.minY, 1);
    const margin = 56;
    const fitted = Math.min(
      (bounds.width - margin * 2) / width,
      (bounds.height - margin * 2) / height,
    );
    this.centerCanvasAtZoom(fitted / BASE_CANVAS_SCALE);
  }

  /** Axis-aligned bounds of everything currently drawn, in diagram units. */
  private contentBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    const board = this.boardPosition();
    let minX = 396 + board.x;
    let minY = 124 + board.y;
    let maxX = 664 + board.x;
    let maxY = 572 + board.y;

    for (const device of this.visibleDevices()) {
      const placement = this.placementFor(device.instanceId);
      const quarterTurned = placement.rotation % 180 !== 0;
      const width = quarterTurned ? device.height : device.width;
      const height = quarterTurned ? device.width : device.height;
      const centerX = placement.x + device.width / 2;
      const centerY = placement.y + device.height / 2;
      minX = Math.min(minX, centerX - width / 2 - 40);
      minY = Math.min(minY, centerY - height / 2 - 24);
      maxX = Math.max(maxX, centerX + width / 2 + 16);
      maxY = Math.max(maxY, centerY + height / 2 + 28);
    }

    return { minX, minY, maxX, maxY };
  }

  // ----------------------------------------------------------- part dragging

  protected beginDeviceDrag(event: PointerEvent, id: string): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (this.placingDeviceId()) return;
    const point = this.svgPoint(event);
    if (!point) return;
    const placement = this.placementFor(id);
    this.selectDevice(id);
    this.dragState = {
      deviceId: id,
      pointerId: event.pointerId,
      offset: { x: point.x - placement.x, y: point.y - placement.y },
    };
    (event.currentTarget as SVGElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  protected beginBoardDrag(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (this.placingDeviceId()) return;
    const point = this.svgPoint(event);
    if (!point) return;
    const position = this.boardPosition();
    this.selectBoard();
    this.boardDragState = {
      pointerId: event.pointerId,
      offset: { x: point.x - position.x, y: point.y - position.y },
    };
    (event.currentTarget as SVGElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  protected beginWireCurveDrag(event: PointerEvent, wireId: string, waypointIndex: number): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.selectedWireId.set(wireId);
    this.selectedDeviceId.set(null);
    this.boardSelected.set(false);
    this.wireCurveDragState = { pointerId: event.pointerId, wireId, waypointIndex };
    (event.currentTarget as SVGElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  protected continueDeviceDrag(event: PointerEvent): void {
    if (this.panState && event.pointerId === this.panState.pointerId) {
      const state = this.panState;
      const client = { x: event.clientX, y: event.clientY };
      if (
        Math.abs(client.x - state.startClient.x) > 3 ||
        Math.abs(client.y - state.startClient.y) > 3
      ) {
        state.moved = true;
      }
      this.scheduleFrame(() =>
        this.canvasPan.set({
          x: state.origin.x + client.x - state.startClient.x,
          y: state.origin.y + client.y - state.startClient.y,
        }),
      );
      event.preventDefault();
      return;
    }
    if (this.boardDragState && event.pointerId === this.boardDragState.pointerId) {
      const offset = this.boardDragState.offset;
      const client = { x: event.clientX, y: event.clientY };
      this.scheduleFrame(() => {
        const point = this.svgPointFromClient(client);
        if (!point) return;
        this.boardPosition.set({ x: point.x - offset.x, y: point.y - offset.y });
      });
      event.preventDefault();
      return;
    }
    if (this.wireCurveDragState && event.pointerId === this.wireCurveDragState.pointerId) {
      const { wireId, waypointIndex } = this.wireCurveDragState;
      const client = { x: event.clientX, y: event.clientY };
      this.scheduleFrame(() => {
        const point = this.svgPointFromClient(client);
        if (point) this.setWireWaypoint(wireId, waypointIndex, point);
      });
      event.preventDefault();
      return;
    }
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) return;
    const state = this.dragState;
    const client = { x: event.clientX, y: event.clientY };
    this.scheduleFrame(() => {
      const point = this.svgPointFromClient(client);
      if (!point) return;
      this.updatePlacement(
        state.deviceId,
        this.snapPoint({ x: point.x - state.offset.x, y: point.y - state.offset.y }),
      );
    });
  }

  protected finishDeviceDrag(event: PointerEvent): void {
    if (this.panState?.pointerId === event.pointerId) {
      const moved = this.panState.moved;
      this.panState = null;
      this.panning.set(false);
      if (!moved && event.button === 0) this.clearSelection();
    }
    if (this.boardDragState?.pointerId === event.pointerId) this.boardDragState = null;
    if (this.wireCurveDragState?.pointerId === event.pointerId) this.wireCurveDragState = null;
    if (this.dragState?.pointerId === event.pointerId) this.dragState = null;
  }

  protected handleBoardKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 20 : 5;
    const position = this.boardPosition();
    let next = position;
    if (event.key === 'ArrowLeft') next = { ...position, x: position.x - step };
    else if (event.key === 'ArrowRight') next = { ...position, x: position.x + step };
    else if (event.key === 'ArrowUp') next = { ...position, y: position.y - step };
    else if (event.key === 'ArrowDown') next = { ...position, y: position.y + step };
    else return;
    this.selectBoard();
    this.boardPosition.set(next);
    event.preventDefault();
  }

  protected handleDeviceKeydown(event: KeyboardEvent, id: string): void {
    const step = this.showGrid() ? GRID_SIZE : event.shiftKey ? 20 : 5;
    const placement = this.placementFor(id);
    let next = { x: placement.x, y: placement.y };
    if (event.key === 'ArrowLeft') next = { ...next, x: next.x - step };
    else if (event.key === 'ArrowRight') next = { ...next, x: next.x + step };
    else if (event.key === 'ArrowUp') next = { ...next, y: next.y - step };
    else if (event.key === 'ArrowDown') next = { ...next, y: next.y + step };
    else return;
    event.preventDefault();
    this.updatePlacement(id, this.snapPoint(next));
  }

  // ------------------------------------------------------------- placement

  /** Queues every selected part so each copy can be placed independently. */
  protected startPlacements(ids: readonly DeviceKind[]): void {
    this.placementQueue = ids.filter((id) => Boolean(deviceById(id)));
    if (!this.placementQueue.length) return;
    this.closeParts();
    this.startNextPlacement();
  }

  private startNextPlacement(): void {
    const id = this.placementQueue.shift() ?? null;
    if (!id) return;
    this.preferences.markRecentlyUsed(id);
    this.pendingPin.set(null);
    this.wirePointer.set(null);
    this.pendingWireWaypoints.set([]);
    this.ghostPoint.set(null);
    this.placingDeviceId.set(id);
    this.canvasViewport()?.nativeElement.focus({ preventScroll: true });
  }

  protected cancelPlacement(): void {
    this.placementQueue = [];
    this.clearCurrentPlacement();
  }

  private clearCurrentPlacement(): void {
    this.placingDeviceId.set(null);
    this.ghostPoint.set(null);
  }

  private dropPlacement(event: PointerEvent): void {
    const id = this.placingDeviceId();
    const device = this.placingDevice();
    if (!id || !device) return;
    event.preventDefault();
    const point = this.svgPoint(event);
    const origin =
      this.ghostPoint() ??
      (point
        ? this.snapPoint({ x: point.x - device.width / 2, y: point.y - device.height / 2 })
        : { x: device.x, y: device.y });
    const instanceId = this.createDeviceInstance(id, origin);
    this.clearCurrentPlacement();
    this.selectDevice(instanceId);
    this.startNextPlacement();
  }

  protected ghostTransform(): string {
    const device = this.placingDevice();
    const point = this.ghostPoint();
    if (!device || !point) return 'translate(-9999 -9999)';
    return `translate(${point.x} ${point.y})`;
  }

  // ----------------------------------------------------------------- wiring

  protected selectDevicePin(event: Event, deviceId: string, pinId: string): void {
    this.selectWireEndpoint(event, { type: 'device', deviceId, pinId });
  }

  protected selectBoardPin(event: Event, pinId: string): void {
    this.selectWireEndpoint(event, { type: 'board', pinId });
  }

  protected pendingWireColor(): string {
    const endpoint = this.pendingPin();
    const kind = endpoint ? this.endpointKind(endpoint) : null;
    return kind === 'ground' ? '#111827' : kind === 'power' ? '#ef4444' : '#22c55e';
  }

  protected wirePreviewPath(): string {
    const endpoint = this.pendingPin();
    const target = this.wirePointer();
    const source = endpoint ? this.endpointPoint(endpoint) : null;
    if (!endpoint || !source || !target) return '';

    const route = [source, ...this.pendingWireWaypoints(), target];
    const distance = Math.min(
      150,
      Math.max(42, Math.hypot(route[1].x - source.x, route[1].y - source.y) * 0.35),
    );
    const tangent = this.endpointOutwardVector(endpoint);
    const sourceControl = {
      x: source.x + tangent.x * distance,
      y: source.y + tangent.y * distance,
    };
    return this.curvedRoutePath(route, sourceControl);
  }

  /**
   * Orthogonal route for one wire.
   *
   * Straight diagonals cut through parts and cross at arbitrary angles, which is
   * what makes a busy diagram unreadable. The router lays Manhattan segments
   * instead and steers around component boxes; hand-placed bends still win,
   * because a user who moved a wire has already said what they want.
   */
  protected wirePath(connection: WireConnection): string {
    const geometry = this.wireGeometry(connection);
    if (!geometry) return '';

    const points = routeWire(
      {
        point: geometry.source,
        side: this.routerSideFor(geometry.source, geometry.sourceControl),
      },
      {
        point: geometry.target,
        side: this.routerSideFor(geometry.target, geometry.targetControl),
      },
      this.routingObstacles(),
      this.resolvedWireWaypoints(connection),
    );

    return orthogonalPath(points);
  }

  /** Derives the exit edge from the tangent the geometry already computed. */
  private routerSideFor(anchor: Point, control: Point): RouterPinSide | undefined {
    const dx = control.x - anchor.x;
    const dy = control.y - anchor.y;
    if (dx === 0 && dy === 0) return undefined;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'bottom' : 'top';
  }

  /**
   * Bounding boxes the router should avoid.
   *
   * Rotation is ignored: an unrotated box is a close enough hint for routing,
   * and computing rotated hulls for every wire on every frame is not worth the
   * cost when the result only nudges a detour.
   */
  private routingObstacles(): readonly Obstacle[] {
    return this.visibleDevices().map((device) => {
      const placement = this.placementFor(device.instanceId);
      const scale = this.renderScale(device);
      return {
        x: placement.x,
        y: placement.y,
        width: device.width * scale,
        height: device.height * scale,
      };
    });
  }

  protected wireControlHandles(connection: WireConnection): readonly WireControlHandle[] {
    const resolvedWaypoints = this.resolvedWireWaypoints(connection);
    return connection.waypoints.flatMap((waypoint, index) =>
      waypoint.junctionId
        ? []
        : [
            {
              ...resolvedWaypoints[index],
              waypointIndex: index,
              trackId: `waypoint-${index}`,
              label: `Bend point ${index + 1}`,
            },
          ],
    );
  }

  protected handleWireControlKeydown(
    event: KeyboardEvent,
    wireId: string,
    waypointIndex: number,
  ): void {
    const step = event.shiftKey ? 20 : 5;
    const connection = this.connections().find((wire) => wire.id === wireId);
    if (!connection) return;
    const current = connection.waypoints[waypointIndex];
    if (!current) return;
    let next = current;
    if (event.key === 'ArrowLeft') next = { ...current, x: current.x - step };
    else if (event.key === 'ArrowRight') next = { ...current, x: current.x + step };
    else if (event.key === 'ArrowUp') next = { ...current, y: current.y - step };
    else if (event.key === 'ArrowDown') next = { ...current, y: current.y + step };
    else return;
    this.setWireWaypoint(wireId, waypointIndex, next);
    event.preventDefault();
    event.stopPropagation();
  }

  protected removeWireBend(event: Event, wireId: string, waypointIndex: number): void {
    event.stopPropagation();
    this.removeWireWaypoint(wireId, waypointIndex);
  }

  protected addWireBend(event: MouseEvent, wireId: string): void {
    event.preventDefault();
    event.stopPropagation();
    const connection = this.connections().find((wire) => wire.id === wireId);
    const point = this.svgPoint(event);
    if (!connection || !point) return;

    const insertionIndex = this.closestWireSegmentIndex(connection, point);
    this.connections.update((connections) =>
      connections.map((wire) => {
        if (wire.id !== wireId) return wire;
        const waypoints = [...wire.waypoints];
        waypoints.splice(insertionIndex, 0, point);
        return { ...wire, waypoints };
      }),
    );
    this.selectedWireId.set(wireId);
    this.selectedDeviceId.set(null);
    this.boardSelected.set(false);
    this.inspectorOpen.set(true);
  }

  protected wireHighlighted(connection: WireConnection): boolean {
    const selectedDeviceId = this.selectedDeviceId();
    return (
      connection.id === this.selectedWireId() ||
      (this.boardSelected() && this.connectionHasBoard(connection)) ||
      (selectedDeviceId !== null && this.connectionHasDevice(connection, selectedDeviceId))
    );
  }

  protected devicePinOnSelectedWire(deviceId: string, pinId: string): boolean {
    return this.selectedWireHasEndpoint({ type: 'device', deviceId, pinId });
  }

  protected boardPinOnSelectedWire(pinId: string): boolean {
    return this.selectedWireHasEndpoint({ type: 'board', pinId });
  }

  protected junctionOnSelectedWire(junctionId: string): boolean {
    return this.selectedWireHasEndpoint({ type: 'junction', junctionId });
  }

  protected pinConnected(deviceId: string, pinId: string): boolean {
    const endpoint: WireEndpoint = { type: 'device', deviceId, pinId };
    return this.connections().some((wire) => this.connectionHasEndpoint(wire, endpoint));
  }

  protected boardPinConnected(pinId: string): boolean {
    const endpoint: WireEndpoint = { type: 'board', pinId };
    return this.connections().some((wire) => this.connectionHasEndpoint(wire, endpoint));
  }

  protected pinPending(deviceId: string, pinId: string): boolean {
    return this.endpointsEqual(this.pendingPin(), { type: 'device', deviceId, pinId });
  }

  protected boardPinPending(pinId: string): boolean {
    return this.endpointsEqual(this.pendingPin(), { type: 'board', pinId });
  }

  protected devicePinCompatible(deviceId: string, pin: DevicePin): boolean {
    const pending = this.pendingPin();
    return pending
      ? this.endpointsCompatible(pending, { type: 'device', deviceId, pinId: pin.name })
      : false;
  }

  /** True while a board pin is a legal target for the wire being drawn. */
  protected boardPinCompatible(pin: BoardPin): boolean {
    const pending = this.pendingPin();
    return pending ? this.endpointsCompatible(pending, { type: 'board', pinId: pin.id }) : false;
  }

  protected importantDevicePin(device: DeviceInstance, pin: DevicePin): boolean {
    if (device.id === 'ultrasonic') return false;
    if (device.pins.length <= 6) return true;
    return pin.kind === 'power' || pin.kind === 'ground' || pin.type === 'reset';
  }

  protected devicePinPoint(device: DeviceInstance, pin: DevicePin): Point {
    const placement = this.placementFor(device.instanceId);
    const scale = this.renderScale(device);
    const center = { x: device.width / 2, y: device.height / 2 };
    const radians = (placement.rotation * Math.PI) / 180;
    const dx = pin.x - center.x;
    const dy = pin.y - center.y;
    // Mirrors deviceTransform exactly: rotate in drawing units, scale, translate.
    return {
      x:
        placement.x +
        scale * (center.x + dx * Math.cos(radians) - dy * Math.sin(radians)),
      y:
        placement.y +
        scale * (center.y + dx * Math.sin(radians) + dy * Math.cos(radians)),
    };
  }

  protected wireEndpointLabel(endpoint: WireEndpoint): string {
    if (endpoint.type === 'board') {
      return `ESP32:${this.boardPinById(endpoint.pinId)?.label ?? endpoint.pinId}`;
    }
    if (endpoint.type === 'junction') return `Junction ${endpoint.junctionId}`;
    const device = this.deviceInstanceById(endpoint.deviceId);
    return `${device?.name ?? endpoint.deviceId}:${endpoint.pinId}`;
  }

  protected selectedDevicePinLabel(connection: WireConnection): string {
    const deviceId = this.selectedDeviceId();
    if (!deviceId) return 'Unknown';
    const endpoint = [connection.start, connection.end].find(
      (candidate): candidate is Extract<WireEndpoint, { type: 'device' }> =>
        candidate.type === 'device' && candidate.deviceId === deviceId,
    );
    return endpoint?.pinId ?? 'Unknown';
  }

  protected selectedDeviceTargetLabel(connection: WireConnection): string {
    const deviceId = this.selectedDeviceId();
    if (!deviceId) return 'Unknown';
    const endpoint = [connection.start, connection.end].find(
      (candidate) => candidate.type !== 'device' || candidate.deviceId !== deviceId,
    );
    return endpoint ? this.wireEndpointLabel(endpoint) : 'Unknown';
  }

  /** Compact silkscreen label printed beside a physical board header. */
  protected boardPinSilkscreen(pin: BoardPin): string {
    const label = pin.label.split(' / ')[0].replace('GPIO ', '');
    const aliases: Readonly<Record<string, string>> = {
      TX0: 'TX',
      RX0: 'RX',
      SD2: 'D2',
      SD3: 'D3',
      SD1: 'D1',
      SD0: 'D0',
      VIN: '5V',
    };
    return aliases[label] ?? label;
  }

  protected boardPinTextX(pin: BoardPin): number {
    return pin.side === 'left' ? pin.x + 13 : pin.x - 13;
  }

  protected boardPinTextTransform(pin: BoardPin): string {
    const x = this.boardPinTextX(pin);
    return `rotate(${pin.side === 'left' ? 90 : -90} ${x} ${pin.y})`;
  }

  // ---------------------------------------------------------------- commands

  protected rotateSelected(): void {
    const id = this.selectedDeviceId();
    if (!id || this.simulationRunning()) return;
    const placement = this.placementFor(id);
    this.updatePlacement(id, { rotation: (placement.rotation + 90) % 360 });
  }

  protected deleteSelection(): void {
    const wireId = this.selectedWireId();
    if (wireId) {
      this.connections.set(
        this.removeWiresAndPruneJunctions(this.connections(), new Set([wireId])),
      );
      this.selectedWireId.set(null);
      const projectId = this.persistedProjectId;
      if (projectId) {
        void this.canvasPersistence
          .removeConnection(projectId, wireId)
          .then(() => this.refreshUsage())
          .catch(() => undefined);
      }
      return;
    }
    const deviceId = this.selectedDeviceId();
    if (!deviceId || this.simulationRunning()) return;
    this.updatePlacement(deviceId, { visible: false });
    this.selectedDeviceId.set(null);
  }

  protected toggleFavoriteDevice(id: DeviceKind): void {
    this.preferences.toggleFavorite(id);
  }

  protected setWireColor(color: string): void {
    const id = this.selectedWireId();
    if (!id) return;
    this.connections.update((connections) =>
      connections.map((wire) => (wire.id === id ? { ...wire, color } : wire)),
    );
  }

  protected toggleSimulation(): void {
    const next = !this.simulationRunning();
    this.simulationRunning.set(next);
    if (next) this.startTicker();
    else this.stopTicker();
    this.pendingPin.set(null);
    this.wirePointer.set(null);
    this.pendingWireWaypoints.set([]);
  }

  protected toggleGrid(): void {
    this.showGrid.update((visible) => !visible);
  }

  protected toggleParts(event?: Event): void {
    if (this.partsOpen()) {
      this.closeParts();
      return;
    }
    this.openParts(event);
  }

  protected openParts(event?: Event): void {
    this.cancelPlacement();
    this.partsOpener = (event?.currentTarget as HTMLButtonElement | null) ?? null;
    this.partsOpen.set(true);
  }

  protected closeParts(): void {
    if (!this.partsOpen()) return;
    const opener = this.partsOpener ?? this.addPartTrigger()?.nativeElement ?? null;
    this.partsOpen.set(false);
    this.partsOpener = null;
    opener?.focus();
  }

  protected toggleSerial(): void {
    this.serialOpen.update((open) => !open);
  }

  protected toggleInspector(): void {
    this.inspectorOpen.update((open) => !open);
  }

  protected buttonPressedFor(deviceId: string | null): boolean {
    if (!deviceId) return false;
    // Parts on the declarative pipeline keep "pressed" in their property state,
    // so read that first or `aria-pressed` would announce a stale value.
    const pressed = this.deviceStates()[deviceId]?.['pressed'];
    if (typeof pressed === 'boolean') return pressed;
    return this.buttonPressedStates()[deviceId] ?? false;
  }

  protected toggleButton(): void {
    const deviceId = this.selectedDeviceId();
    if (!deviceId) return;
    this.buttonPressedStates.update((states) => ({
      ...states,
      [deviceId]: !this.buttonPressedFor(deviceId),
    }));
  }

  /**
   * Momentary press straight on the canvas artwork.
   *
   * Parts that declare a `pressed` property route through the property state so
   * the simulation actually sees the contact close. Without this the canvas
   * press and the inspector toggle would be two disconnected notions of
   * "pressed", and only the inspector one would affect the circuit.
   */
  protected pressButton(event: Event, deviceId: string, pressed: boolean): void {
    event.stopPropagation();

    const device = this.deviceInstanceById(deviceId);
    if (device?.properties?.some((property) => property.id === 'pressed')) {
      this.deviceStates.update((states) => ({
        ...states,
        [deviceId]: {
          ...(states[deviceId] ?? defaultStateFor(device.properties)),
          pressed,
        },
      }));
      return;
    }

    if (pressed || this.buttonPressedFor(deviceId)) {
      this.buttonPressedStates.update((states) => ({ ...states, [deviceId]: pressed }));
    }
  }

  protected toggleRelay(): void {
    const id = this.selectedDeviceId();
    const current = id ? this.relayChannelStates()[id] : undefined;
    if (!this.simulationRunning() || !id || !current) return;
    const nextState = !current.every(Boolean);
    this.relayChannelStates.update((states) => ({ ...states, [id]: current.map(() => nextState) }));
  }

  protected relayChannelOn(deviceId: string, channelIndex: number): boolean {
    return this.relayChannelStates()[deviceId]?.[channelIndex] ?? false;
  }

  protected toggleRelayChannel(event: Event, deviceId: string, channelIndex: number): void {
    event.stopPropagation();
    if (!this.simulationRunning()) return;
    const current = this.relayChannelStates()[deviceId];
    if (!current || channelIndex < 0 || channelIndex >= current.length) return;
    this.relayChannelStates.update((states) => ({
      ...states,
      [deviceId]: current.map((isOn, index) => (index === channelIndex ? !isOn : isOn)),
    }));
  }

  protected updateDistance(event: Event): void {
    this.distance.set(Number((event.target as HTMLInputElement).value));
  }

  protected updateServoAngle(event: Event): void {
    this.servoAngle.set(Number((event.target as HTMLInputElement).value));
  }

  protected resetDiagram(): void {
    this.deviceInstances.set([...INITIAL_DEVICE_INSTANCES]);
    this.placements.set({ ...INITIAL_PLACEMENTS });
    this.connections.set([...INITIAL_CONNECTIONS]);
    this.relayChannelStates.set(INITIAL_RELAY_STATES);
    this.deviceStates.set(INITIAL_DEVICE_STATES);
    this.buttonPressedStates.set({});
    this.selectedDeviceId.set(null);
    this.boardSelected.set(false);
    this.selectedWireId.set(null);
    this.pendingPin.set(null);
    this.wirePointer.set(null);
    this.pendingWireWaypoints.set([]);
    this.cancelPlacement();
    this.boardPosition.set({ x: 0, y: 0 });
    this.wireJunctions.set({});
    this.junctionSequence = 0;
    this.deviceSequence = 0;
    this.fitCanvas();
  }

  protected handleEditorKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.pendingPin.set(null);
      this.wirePointer.set(null);
      this.pendingWireWaypoints.set([]);
      this.cancelPlacement();
      if (this.partsOpen()) this.closeParts();
      return;
    }
    if (this.partsOpen()) return;
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteSelection();
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'r') this.rotateSelected();
    else if (key === 'g') this.toggleGrid();
    else if (key === 'a') this.openParts();
    else if (key === 'f') this.fitCanvas();
  }

  // ----------------------------------------------------------------- private

  private updatePlacement(id: string, patch: Partial<DevicePlacement>): void {
    this.placements.update((placements) => ({
      ...placements,
      [id]: { ...placements[id], ...patch },
    }));

    // Every move, rotation, and removal passes through here, which is why the
    // write lives here rather than in each caller. The service coalesces a
    // drag's many updates into one request.
    const projectId = this.persistedProjectId;
    if (!projectId) return;

    if (patch.visible === false) {
      void this.canvasPersistence.remove(projectId, id).catch(() => undefined);
      return;
    }

    const transform: { x?: number; y?: number; rotation?: number } = {};
    if (patch.x !== undefined) transform.x = patch.x;
    if (patch.y !== undefined) transform.y = patch.y;
    if (patch.rotation !== undefined) transform.rotation = patch.rotation;
    if (Object.keys(transform).length > 0) {
      this.canvasPersistence.queueTransform(projectId, id, transform);
    }
  }

  private createDeviceInstance(kind: DeviceKind, origin: Point): string {
    // Reusing a hidden instance is only safe without persistence. With a project
    // behind the canvas, hiding a component deletes it server-side, so reviving
    // that id would resurrect a row that no longer exists.
    const reusable = this.persistedProjectId
      ? undefined
      : this.deviceInstances().find(
          (device) =>
            device.id === kind && !this.placements()[device.instanceId]?.visible,
        );
    let instance = reusable;

    if (!instance) {
      const device = deviceById(kind);
      if (!device) return kind;
      let instanceId = `${kind}-${++this.deviceSequence}`;
      while (this.placements()[instanceId]) instanceId = `${kind}-${++this.deviceSequence}`;
      instance = { ...device, instanceId };
      this.deviceInstances.update((devices) => [...devices, instance!]);
    }

    this.placements.update((placements) => ({
      ...placements,
      [instance.instanceId]: { ...origin, rotation: 0, visible: true },
    }));
    if (instance.relayChannels) {
      this.relayChannelStates.update((states) => ({
        ...states,
        [instance.instanceId]: instance.relayChannels!.map(() => false),
      }));
    }
    if (instance.properties?.length) {
      this.deviceStates.update((states) => ({
        ...states,
        [instance.instanceId]: defaultStateFor(instance.properties),
      }));
    }

    // The part appears immediately under a temporary id; the server's id
    // replaces it once the write lands. Waiting for the round trip first would
    // make placing a component feel laggy.
    if (this.persistedProjectId && !reusable) {
      void this.persistNewComponent(instance.instanceId, kind, origin);
    }

    return instance.instanceId;
  }

  /**
   * Restores the project's wires.
   *
   * A wire whose component was skipped — because its definition is not in this
   * build — is skipped too, so the canvas never holds a wire pointing at a part
   * it cannot draw.
   */
  private async restorePersistedConnections(
    projectId: string,
    knownComponentIds: ReadonlySet<string>,
  ): Promise<void> {
    const stored = await this.canvasPersistence.loadConnections(projectId);

    const restored = stored
      .filter(
        (connection) =>
          knownComponentIds.has(connection.from.componentId) &&
          knownComponentIds.has(connection.to.componentId),
      )
      .map((connection) => ({
        id: connection.id,
        start: {
          type: 'device' as const,
          deviceId: connection.from.componentId,
          pinId: connection.from.pinId,
        },
        end: {
          type: 'device' as const,
          deviceId: connection.to.componentId,
          pinId: connection.to.pinId,
        },
        waypoints: connection.waypoints.map((point) => ({ ...point })),
        color: connection.color,
        kind: connection.kind,
      }));

    this.connections.set(restored);
  }

  /**
   * Maps a canvas endpoint onto the stored form.
   *
   * Only device pins can be stored: the fixed demo board and junctions have no
   * rows behind them, so a wire touching either is kept on the canvas but not
   * written. Returning null is how the caller learns that.
   */
  private storableEndpoint(
    endpoint: WireEndpoint,
  ): { componentId: string; pinId: string } | null {
    return endpoint.type === 'device'
      ? { componentId: endpoint.deviceId, pinId: endpoint.pinId }
      : null;
  }

  private async persistNewConnection(
    connection: WireConnection,
  ): Promise<void> {
    const projectId = this.persistedProjectId;
    if (!projectId) return;

    const from = this.storableEndpoint(connection.start);
    const to = this.storableEndpoint(connection.end);
    if (!from || !to) {
      this.componentLimitMessage.set(
        'This wire is not saved: junction taps are not stored yet.',
      );
      return;
    }

    try {
      const created = await this.canvasPersistence.addConnection(projectId, {
        from,
        to,
        color: connection.color,
        kind: connection.kind,
        waypoints: connection.waypoints
          .filter((waypoint) => !waypoint.junctionId)
          .map((waypoint) => ({ x: waypoint.x, y: waypoint.y })),
      } as Omit<CanvasConnection, 'id'>);

      if (created) {
        this.adoptConnectionId(connection.id, created.id);
        void this.refreshUsage();
      }
    } catch (error) {
      const refusal = asConnectionLimitRefusal(error);
      this.componentLimitMessage.set(
        refusal ? refusal.message : 'Could not save this connection',
      );
      // Drop it rather than leaving a wire the project does not contain.
      this.connections.update((connections) =>
        connections.filter((wire) => wire.id !== connection.id),
      );
      if (this.selectedWireId() === connection.id) this.selectedWireId.set(null);
    }
  }

  /**
   * Queues the wire's bends for writing.
   *
   * Read after the signal update on the next tick, so the queued set is the one
   * the user actually sees rather than the value from before the edit.
   */
  private queueWaypointSave(wireId: string): void {
    const projectId = this.persistedProjectId;
    if (!projectId) return;

    queueMicrotask(() => {
      const wire = this.connections().find((item) => item.id === wireId);
      if (!wire) return;

      this.canvasPersistence.queueWaypoints(
        projectId,
        wireId,
        wire.waypoints
          .filter((waypoint) => !waypoint.junctionId)
          .map((waypoint) => ({ x: waypoint.x, y: waypoint.y })),
      );
    });
  }

  /** Re-keys a new wire onto the id the server assigned. */
  private adoptConnectionId(localId: string, serverId: string): void {
    if (localId === serverId) return;
    this.connections.update((connections) =>
      connections.map((wire) =>
        wire.id === localId ? { ...wire, id: serverId } : wire,
      ),
    );
    if (this.selectedWireId() === localId) this.selectedWireId.set(serverId);
  }

  /** Reads the plan counts. Display only — the API still decides every write. */
  private async refreshUsage(): Promise<void> {
    const projectId = this.persistedProjectId;
    if (!projectId) return;

    try {
      const report = await this.canvasPersistence.usage(projectId);
      this.projectUsage.set(
        report?.metrics.map((metric) => ({
          label: metric.label,
          used: metric.used,
          limit: metric.limit,
          unlimited: metric.unlimited,
        })) ?? [],
      );
    } catch {
      this.projectUsage.set([]);
    }
  }

  private async persistNewComponent(
    localId: string,
    definitionId: DeviceKind,
    origin: Point,
  ): Promise<void> {
    const projectId = this.persistedProjectId;
    if (!projectId) return;

    try {
      const created = await this.canvasPersistence.add(projectId, definitionId, {
        x: origin.x,
        y: origin.y,
      });
      if (created) {
        this.adoptServerId(localId, created.id);
        void this.refreshUsage();
      }
    } catch (error) {
      const refusal = asComponentLimitRefusal(error);
      this.componentLimitMessage.set(
        refusal ? refusal.message : 'Could not save this device',
      );
      // Roll the part back off the canvas: leaving it visible would promise a
      // device the project does not actually contain.
      this.discardLocalComponent(localId);
    }
  }

  /**
   * Re-keys a freshly placed component onto the id the server assigned.
   *
   * Only a new component is ever re-keyed, and a new component has no wires yet,
   * so nothing else holds a reference to the temporary id.
   */
  private adoptServerId(localId: string, serverId: string): void {
    if (localId === serverId) return;

    this.deviceInstances.update((devices) =>
      devices.map((device) =>
        device.instanceId === localId
          ? { ...device, instanceId: serverId }
          : device,
      ),
    );
    this.placements.update((placements) => {
      const { [localId]: moved, ...rest } = placements;
      return moved ? { ...rest, [serverId]: moved } : placements;
    });
    this.deviceStates.update((states) => {
      const { [localId]: moved, ...rest } = states;
      return moved ? { ...rest, [serverId]: moved } : states;
    });
    if (this.selectedDeviceId() === localId) this.selectedDeviceId.set(serverId);
  }

  private discardLocalComponent(localId: string): void {
    this.deviceInstances.update((devices) =>
      devices.filter((device) => device.instanceId !== localId),
    );
    this.placements.update((placements) => {
      const { [localId]: _removed, ...rest } = placements;
      return rest;
    });
    if (this.selectedDeviceId() === localId) this.selectedDeviceId.set(null);
  }

  private deviceInstanceById(id: string): DeviceInstance | undefined {
    return this.deviceInstances().find((device) => device.instanceId === id);
  }

  private snapPoint(point: Point): Point {
    if (!this.showGrid()) return point;
    return {
      x: Math.round(point.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(point.y / GRID_SIZE) * GRID_SIZE,
    };
  }

  private scheduleFrame(action: () => void): void {
    this.frameAction = action;
    if (this.frameRequest) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      const next = this.frameAction;
      this.frameAction = null;
      next?.();
    });
  }

  private zoomAtViewportCenter(nextZoom: number): void {
    const viewport = this.canvasViewport()?.nativeElement;
    const bounds = viewport?.getBoundingClientRect();
    this.zoomAround({ x: (bounds?.width ?? 0) / 2, y: (bounds?.height ?? 0) / 2 }, nextZoom);
  }

  private centerCanvasAtZoom(nextZoom: number): void {
    const zoom = this.normalizedZoom(nextZoom);
    const viewport = this.canvasViewport()?.nativeElement;
    this.zoom.set(zoom);

    if (!viewport) {
      this.canvasPan.set({ x: 0, y: 0 });
      return;
    }

    const bounds = viewport.getBoundingClientRect();
    const content = this.contentBounds();
    const width = Math.max(content.maxX - content.minX, 1);
    const height = Math.max(content.maxY - content.minY, 1);
    const scale = BASE_CANVAS_SCALE * zoom;
    this.canvasPan.set({
      x: Math.round(bounds.width / 2 - (content.minX + width / 2) * scale),
      y: Math.round(bounds.height / 2 - (content.minY + height / 2) * scale),
    });
  }

  private zoomAround(anchor: Point, nextZoom: number): void {
    const current = this.zoom();
    if (nextZoom === current) return;
    const ratio = nextZoom / current;
    this.canvasPan.update((pan) => ({
      x: anchor.x - (anchor.x - pan.x) * ratio,
      y: anchor.y - (anchor.y - pan.y) * ratio,
    }));
    this.zoom.set(nextZoom);
  }

  private normalizedZoom(value: number): number {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value * 100) / 100));
  }

  private selectWireEndpoint(event: Event, endpoint: WireEndpoint): void {
    event.stopPropagation();
    event.preventDefault();
    if (this.simulationRunning() || this.placingDeviceId()) return;

    const pending = this.pendingPin();
    if (this.endpointsEqual(pending, endpoint)) {
      this.pendingPin.set(null);
      this.wirePointer.set(null);
      this.pendingWireWaypoints.set([]);
      return;
    }

    if (pending && this.endpointsCompatible(pending, endpoint)) {
      this.finishPendingWire(endpoint);
      return;
    }

    // An incompatible pin starts a fresh wire, so every pin always responds to a click.
    this.pendingPin.set(endpoint);
    this.wirePointer.set(this.endpointPoint(endpoint));
    this.pendingWireWaypoints.set([]);
    this.selectedWireId.set(null);
    this.selectedDeviceId.set(endpoint.type === 'device' ? endpoint.deviceId : null);
    this.boardSelected.set(endpoint.type === 'board');
  }

  private connectPendingWireToWire(event: PointerEvent, wireId: string): void {
    event.stopPropagation();
    event.preventDefault();
    const pending = this.pendingPin();
    const targetWire = this.connections().find((wire) => wire.id === wireId);
    const point = this.svgPoint(event);
    if (
      !pending ||
      !targetWire ||
      !point ||
      this.endpointKind(pending) !== targetWire.kind ||
      this.connectionHasEndpoint(targetWire, pending)
    ) {
      return;
    }

    const junctionId = `junction-${++this.junctionSequence}`;
    const junction: WireJunction = { id: junctionId, kind: targetWire.kind, ...point };
    const insertionIndex = this.closestWireSegmentIndex(targetWire, point);
    this.wireJunctions.update((junctions) => ({ ...junctions, [junctionId]: junction }));
    this.connections.update((connections) =>
      connections.map((wire) => {
        if (wire.id !== wireId) return wire;
        const waypoints = [...wire.waypoints];
        waypoints.splice(insertionIndex, 0, { ...point, junctionId });
        return { ...wire, waypoints };
      }),
    );
    this.finishPendingWire({ type: 'junction', junctionId });
  }

  private finishPendingWire(endpoint: WireEndpoint): void {
    const pending = this.pendingPin();
    const kind = pending ? this.endpointKind(pending) : null;
    if (!pending || !kind) return;
    const color = kind === 'ground' ? '#111827' : kind === 'power' ? '#ef4444' : '#22c55e';
    const connection: WireConnection = {
      id: `wire-${++this.wireSequence}`,
      start: pending,
      end: endpoint,
      waypoints: [...this.pendingWireWaypoints()],
      color,
      kind,
    };
    const currentConnections = this.connections();
    // Pins are shared electrical nodes: one VCC, GND, or signal pin may fan out to
    // any number of other pins. Only replace an exact duplicate connection.
    const duplicateWireIds = new Set(
      currentConnections
        .filter(
          (wire) =>
            (this.endpointsEqual(wire.start, pending) && this.endpointsEqual(wire.end, endpoint)) ||
            (this.endpointsEqual(wire.start, endpoint) && this.endpointsEqual(wire.end, pending)),
        )
        .map((wire) => wire.id),
    );
    this.connections.set(
      this.removeWiresAndPruneJunctions([...currentConnections, connection], duplicateWireIds),
    );
    this.pendingPin.set(null);
    this.wirePointer.set(null);
    this.pendingWireWaypoints.set([]);
    this.selectedWireId.set(connection.id);
    this.selectedDeviceId.set(null);
    this.boardSelected.set(false);
    this.inspectorOpen.set(true);

    // The wire is on the canvas already; the write swaps in the server's id.
    void this.persistNewConnection(connection);
  }

  private connectionSource(connection: WireConnection): Point | null {
    return this.endpointPoint(connection.start);
  }

  private connectionTarget(connection: WireConnection): Point | null {
    return this.endpointPoint(connection.end);
  }

  private wireBaseGeometry(connection: WireConnection): WireGeometry | null {
    const source = this.connectionSource(connection);
    const target = this.connectionTarget(connection);
    if (!source || !target) return null;
    const distance = Math.hypot(target.x - source.x, target.y - source.y);
    const controlDistance = Math.min(180, Math.max(45, distance * 0.34));
    const sourceTangent =
      connection.start.type === 'junction'
        ? this.unitVector(source, target)
        : this.endpointOutwardVector(connection.start);
    const targetTangent =
      connection.end.type === 'junction'
        ? this.unitVector(target, source)
        : this.endpointOutwardVector(connection.end);
    const sourceControl = {
      x: source.x + sourceTangent.x * controlDistance,
      y: source.y + sourceTangent.y * controlDistance,
    };
    const targetControl = {
      x: target.x + targetTangent.x * controlDistance,
      y: target.y + targetTangent.y * controlDistance,
    };
    return { source, sourceControl, targetControl, target };
  }

  private wireGeometry(connection: WireConnection): WireGeometry | null {
    return this.wireBaseGeometry(connection);
  }

  private setWireWaypoint(wireId: string, waypointIndex: number, point: Point): void {
    const connection = this.connections().find((wire) => wire.id === wireId);
    const waypoint = connection?.waypoints[waypointIndex];
    if (!waypoint) return;
    if (waypoint.junctionId) {
      this.wireJunctions.update((junctions) => {
        const junction = junctions[waypoint.junctionId!];
        return junction ? { ...junctions, [junction.id]: { ...junction, ...point } } : junctions;
      });
      return;
    }
    this.queueWaypointSave(wireId);
    this.connections.update((connections) =>
      connections.map((wire) =>
        wire.id === wireId
          ? {
              ...wire,
              waypoints: wire.waypoints.map((waypoint, index) =>
                index === waypointIndex ? point : waypoint,
              ),
            }
          : wire,
      ),
    );
  }

  private removeWireWaypoint(wireId: string, waypointIndex: number): void {
    const waypoint = this.connections().find((wire) => wire.id === wireId)?.waypoints[
      waypointIndex
    ];
    if (waypoint?.junctionId) return;
    this.connections.update((connections) =>
      connections.map((wire) =>
        wire.id === wireId
          ? {
              ...wire,
              waypoints: wire.waypoints.filter((_, index) => index !== waypointIndex),
            }
          : wire,
      ),
    );
  }

  private removeWiresAndPruneJunctions(
    connections: readonly WireConnection[],
    initialWireIds: ReadonlySet<string>,
  ): readonly WireConnection[] {
    const junctions = this.wireJunctions();
    const wireIdsToRemove = new Set(initialWireIds);
    const junctionIdsToRemove = new Set<string>();
    let stateChanged = true;

    while (stateChanged) {
      stateChanged = false;

      for (const wire of connections) {
        if (!wireIdsToRemove.has(wire.id)) continue;
        for (const waypoint of wire.waypoints) {
          if (waypoint.junctionId && !junctionIdsToRemove.has(waypoint.junctionId)) {
            junctionIdsToRemove.add(waypoint.junctionId);
            stateChanged = true;
          }
        }
      }

      const remainingJunctionOwners = new Set(
        connections
          .filter((wire) => !wireIdsToRemove.has(wire.id))
          .flatMap((wire) =>
            wire.waypoints.flatMap((waypoint) =>
              waypoint.junctionId ? [waypoint.junctionId] : [],
            ),
          ),
      );

      for (const wire of connections) {
        if (wireIdsToRemove.has(wire.id)) continue;
        const junctionEndpoints = [wire.start, wire.end].filter(
          (endpoint): endpoint is Extract<WireEndpoint, { type: 'junction' }> =>
            endpoint.type === 'junction',
        );
        const hasInvalidJunction = junctionEndpoints.some(
          ({ junctionId }) =>
            junctionIdsToRemove.has(junctionId) ||
            !remainingJunctionOwners.has(junctionId) ||
            !junctions[junctionId],
        );
        if (hasInvalidJunction) {
          wireIdsToRemove.add(wire.id);
          stateChanged = true;
        }
      }
    }

    const remainingConnections = connections.filter((wire) => !wireIdsToRemove.has(wire.id));
    const referencedJunctionIds = new Set(
      remainingConnections.flatMap((wire) =>
        [wire.start, wire.end].flatMap((endpoint) =>
          endpoint.type === 'junction' ? [endpoint.junctionId] : [],
        ),
      ),
    );
    const ownedJunctionIds = new Set(
      remainingConnections.flatMap((wire) =>
        wire.waypoints.flatMap((waypoint) => (waypoint.junctionId ? [waypoint.junctionId] : [])),
      ),
    );
    const retainedJunctionIds = new Set(
      [...referencedJunctionIds].filter(
        (junctionId) => ownedJunctionIds.has(junctionId) && junctions[junctionId],
      ),
    );
    const cleanedConnections = remainingConnections.map((wire) => ({
      ...wire,
      waypoints: wire.waypoints.filter(
        (waypoint) => !waypoint.junctionId || retainedJunctionIds.has(waypoint.junctionId),
      ),
    }));
    const retainedJunctions = Object.fromEntries(
      [...retainedJunctionIds].map((junctionId) => [junctionId, junctions[junctionId]]),
    );
    this.wireJunctions.set(retainedJunctions);

    const pending = this.pendingPin();
    if (pending?.type === 'junction' && !retainedJunctionIds.has(pending.junctionId)) {
      this.pendingPin.set(null);
      this.wirePointer.set(null);
      this.pendingWireWaypoints.set([]);
    }

    return cleanedConnections;
  }

  private resolvedWireWaypoints(connection: WireConnection): readonly Point[] {
    const junctions = this.wireJunctions();
    return connection.waypoints.map((waypoint) =>
      waypoint.junctionId ? (junctions[waypoint.junctionId] ?? waypoint) : waypoint,
    );
  }

  private closestWireSegmentIndex(connection: WireConnection, point: Point): number {
    const source = this.connectionSource(connection);
    const target = this.connectionTarget(connection);
    if (!source || !target) return connection.waypoints.length;
    const anchors = [source, ...this.resolvedWireWaypoints(connection), target];
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < anchors.length - 1; index++) {
      const distance = this.pointToSegmentDistanceSquared(
        point,
        anchors[index],
        anchors[index + 1],
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }
    return closestIndex;
  }

  private pointToSegmentDistanceSquared(point: Point, start: Point, end: Point): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
    const amount = Math.max(
      0,
      Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
    );
    const projectedX = start.x + amount * dx;
    const projectedY = start.y + amount * dy;
    return (point.x - projectedX) ** 2 + (point.y - projectedY) ** 2;
  }

  /** Smooth cubic route that passes through every clicked bend anchor. */
  private curvedRoutePath(
    points: readonly Point[],
    sourceControl?: Point,
    targetControl?: Point,
  ): string {
    if (points.length < 2) return '';
    let path = `M ${points[0].x} ${points[0].y}`;
    const lastSegment = points.length - 2;

    for (let index = 0; index <= lastSegment; index++) {
      const previous = points[index - 1] ?? points[index];
      const start = points[index];
      const end = points[index + 1];
      const next = points[index + 2] ?? end;
      const firstControl =
        index === 0 && sourceControl
          ? sourceControl
          : {
              x: start.x + (end.x - previous.x) / 6,
              y: start.y + (end.y - previous.y) / 6,
            };
      const secondControl =
        index === lastSegment && targetControl
          ? targetControl
          : {
              x: end.x - (next.x - start.x) / 6,
              y: end.y - (next.y - start.y) / 6,
            };
      path += ` C ${firstControl.x} ${firstControl.y}, ${secondControl.x} ${secondControl.y}, ${end.x} ${end.y}`;
    }

    return path;
  }

  private endpointPoint(endpoint: WireEndpoint): Point | null {
    if (endpoint.type === 'board') {
      const pin = this.boardPinById(endpoint.pinId);
      const position = this.boardPosition();
      return pin ? { x: pin.x + position.x, y: pin.y + position.y } : null;
    }
    if (endpoint.type === 'junction') return this.wireJunctions()[endpoint.junctionId] ?? null;
    const device = this.deviceInstanceById(endpoint.deviceId);
    const pin = device?.pins.find((candidate) => candidate.name === endpoint.pinId);
    return device && pin ? this.devicePinPoint(device, pin) : null;
  }

  private endpointKind(endpoint: WireEndpoint): BoardPin['kind'] | null {
    if (endpoint.type === 'board') return this.boardPinById(endpoint.pinId)?.kind ?? null;
    if (endpoint.type === 'junction')
      return this.wireJunctions()[endpoint.junctionId]?.kind ?? null;
    return (
      this.deviceInstanceById(endpoint.deviceId)?.pins.find((pin) => pin.name === endpoint.pinId)
        ?.kind ?? null
    );
  }

  private endpointOutwardVector(endpoint: WireEndpoint): Point {
    if (endpoint.type === 'board') {
      return this.boardPinById(endpoint.pinId)?.side === 'left' ? { x: -1, y: 0 } : { x: 1, y: 0 };
    }
    if (endpoint.type === 'junction') return { x: 0, y: 0 };

    const device = this.deviceInstanceById(endpoint.deviceId);
    const pin = device?.pins.find((candidate) => candidate.name === endpoint.pinId);
    if (!device || !pin) return { x: 1, y: 0 };
    let vector: Point;
    if (pin.side === 'top') vector = { x: 0, y: -1 };
    else if (pin.side === 'bottom' || pin.y >= device.height) vector = { x: 0, y: 1 };
    else if (pin.x <= 0) vector = { x: -1, y: 0 };
    else if (pin.x >= device.width) vector = { x: 1, y: 0 };
    else if (pin.y <= 0) vector = { x: 0, y: -1 };
    else vector = { x: 1, y: 0 };

    const radians = (this.placementFor(endpoint.deviceId).rotation * Math.PI) / 180;
    return {
      x: vector.x * Math.cos(radians) - vector.y * Math.sin(radians),
      y: vector.x * Math.sin(radians) + vector.y * Math.cos(radians),
    };
  }

  private endpointsCompatible(start: WireEndpoint, end: WireEndpoint): boolean {
    if (this.endpointsEqual(start, end)) return false;
    const startKind = this.endpointKind(start);
    const endKind = this.endpointKind(end);
    if (startKind === null || endKind === null) return false;
    // A bare terminal — a resistor lead, a switch pole — belongs to whatever
    // net it is wired into, so it may bridge power, ground, and signal.
    if (this.endpointPassive(start) || this.endpointPassive(end)) return true;
    return startKind === endKind;
  }

  /** True when an endpoint is a two-terminal contact with no fixed role. */
  private endpointPassive(endpoint: WireEndpoint): boolean {
    if (endpoint.type !== 'device') return false;
    const pin = this.deviceInstanceById(endpoint.deviceId)?.pins.find(
      (candidate) => candidate.name === endpoint.pinId,
    );
    return isPassivePinType(pin?.type);
  }

  private endpointsEqual(left: WireEndpoint | null, right: WireEndpoint | null): boolean {
    if (!left || !right || left.type !== right.type) return false;
    if (left.type === 'board') return right.type === 'board' && left.pinId === right.pinId;
    if (left.type === 'junction') {
      return right.type === 'junction' && left.junctionId === right.junctionId;
    }
    return (
      right.type === 'device' && left.deviceId === right.deviceId && left.pinId === right.pinId
    );
  }

  private connectionHasEndpoint(connection: WireConnection, endpoint: WireEndpoint): boolean {
    return (
      this.endpointsEqual(connection.start, endpoint) ||
      this.endpointsEqual(connection.end, endpoint)
    );
  }

  private selectedWireHasEndpoint(endpoint: WireEndpoint): boolean {
    const wire = this.selectedWire();
    return wire ? this.connectionHasEndpoint(wire, endpoint) : false;
  }

  private connectionHasDevice(connection: WireConnection, deviceId: string): boolean {
    return [connection.start, connection.end].some(
      (endpoint) => endpoint.type === 'device' && endpoint.deviceId === deviceId,
    );
  }

  private connectionHasBoard(connection: WireConnection): boolean {
    return [connection.start, connection.end].some((endpoint) => endpoint.type === 'board');
  }

  private endpointVisible(endpoint: WireEndpoint): boolean {
    if (endpoint.type === 'board') return true;
    if (endpoint.type === 'junction') return Boolean(this.wireJunctions()[endpoint.junctionId]);
    return this.placements()[endpoint.deviceId]?.visible ?? false;
  }

  private unitVector(from: Point, to: Point): Point {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    return distance > 0
      ? { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance }
      : { x: 0, y: 0 };
  }

  private boardPinById(id: string): BoardPin | undefined {
    return this.boardPins.find((pin) => pin.id === id);
  }

  private svgPoint(event: MouseEvent): Point | null {
    return this.svgPointFromClient({ x: event.clientX, y: event.clientY });
  }

  private svgPointFromClient(client: Point): Point | null {
    const svg = this.canvasSvg()?.nativeElement;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = client.x;
    point.y = client.y;
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
  }
}
