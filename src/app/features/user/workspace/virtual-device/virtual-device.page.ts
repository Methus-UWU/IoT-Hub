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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SerialMonitorResize } from './serial-monitor-resize';

import {
  CustomSelect,
  type CustomSelectOption,
} from '../../../../shared/components/custom-select/custom-select';
import { ProjectStore } from '../../projects/project.store';
import { AddDeviceModal } from './add-device-modal/add-device-modal';
import { DeviceArt } from './device-art/device-art';
import { DeviceKind } from './device-library.models';
import { defaultStateFor, type DevicePropertyDefinition } from './devices/core/device-definition';
import { DEVICES, DEVICE_LIBRARY_ITEMS, deviceById } from './devices/device-catalog';
import { drawingScaleFor } from './devices/core/device-metrics';
import { CircuitHistory, type CircuitSnapshot } from './services/circuit-history';
import {
  ProjectCanvasService,
  asBoardLimitRefusal,
  asComponentLimitRefusal,
  asConnectionLimitRefusal,
  type CanvasConnection,
} from './services/project-canvas.service';
import { INITIAL_CONNECTIONS, WIRE_COLORS } from './devices/demo-circuit';
import type {
  ConnectionKind,
  DeviceInstance,
  DevicePin,
  DevicePlacement,
  DeviceState,
  Point,
  VirtualDevice,
  WireConnection,
  WireEndpoint,
  WireJunction,
  WireWaypoint,
} from './models/virtual-device.model';
import { CanvasSnapshotCache, type CanvasSnapshot } from './services/canvas-snapshot-cache';
import { layoutNewParts } from './layout/auto-layout';
import { isBoardCategory } from './device-library.models';
import { FirmwareLoaderService } from './services/firmware-loader.service';
import type { DeviceBehavior } from './devices/core/device-simulation';
import type { DeviceHotspot } from './devices/core/device-hotspots';
import { pinTooltip } from './devices/core/device-pin';
import { isPassivePinType } from './devices/core/device-types';
import { CircuitAudioService, type SustainedSound } from './services/circuit-audio.service';
import { DevicePreferenceService } from './services/device-preference.service';
import { devicePinKey, simulateTick, type SimulationResult } from './simulation/circuit-simulator';
import { SEVERITY_LABELS, validateCircuit, type WireIssue } from './simulation/wire-validation';
import { DeviceInspector, type PropertyChange } from './device-inspector/device-inspector';

interface DragState {
  deviceId: string;
  pointerId: number;
  offset: Point;
}

interface WireCurveDragState {
  pointerId: number;
  wireId: string;
  waypointIndex: number;
}

/** Folds any angle into (-180, 180], so a turn past the seam does not wrap. */
function normalizeDegrees(degrees: number): number {
  const wrapped = ((degrees + 180) % 360) - 180;
  return wrapped <= -180 ? wrapped + 360 : wrapped;
}

/** A knob being turned: the pointer's angle about the shaft drives a property. */
interface RotaryDragState {
  pointerId: number;
  deviceId: string;
  hotspot: DeviceHotspot;
  /** Pointer angle at the previous sample, in canvas degrees clockwise from up. */
  lastAngle: number;
  /** Travel accumulated since the grab, in degrees either side of centre. */
  travel: number;
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

/** The signal values a cached layout was shown with; a different value means the user edited. */
interface CanvasSnapshotRefs {
  readonly placements: Record<string, DevicePlacement>;
  readonly deviceStates: Record<string, DeviceState>;
  readonly connections: readonly WireConnection[];
}

interface PanState {
  pointerId: number;
  startClient: Point;
  origin: Point;
  moved: boolean;
}


/** Shared empty state so parts without properties never allocate per render. */
const EMPTY_STATE: DeviceState = Object.freeze({});

/** Runtime key a relay publishes per channel: `ch1`, `ch2`, … */
const RELAY_CONTACT_KEY = /^ch\d+$/;

/** Whether two merged states carry the same values, which is all the art reads. */
function sameState(a: DeviceState, b: DeviceState): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

/** Result used whenever the simulation is stopped. */
const EMPTY_SIMULATION: SimulationResult = Object.freeze({
  runtime: {},
  pinStates: new Map(),
  shorts: [],
});

/** The property values worth saving: everything except what the solver writes. */
function savedStateOf(
  device: VirtualDevice,
  state: DeviceState | undefined,
): Record<string, string | number | boolean> {
  const saved: Record<string, string | number | boolean> = {};
  for (const property of device.properties ?? []) {
    const value = state?.[property.id];
    if (!property.simulationOnly && value !== undefined) saved[property.id] = value;
  }
  return saved;
}

/** Diagram coordinate system. CSS dimensions scale this viewBox without rasterizing it. */
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 720;
const BASE_CANVAS_SCALE = 0.6;
const GRID_SIZE = 25;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;
const MAX_BOARD_COUNT = 1;
/** Standard rates the ESP32 bootloader and Arduino serial monitor both accept. */
const SERIAL_BAUD_OPTIONS: readonly CustomSelectOption[] = [
  9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600,
].map((baud) => ({ value: baud.toString(), label: `${baud} baud` }));
/** Above this pin count a part only ever labels the pin under the pointer. */
const MAX_LABELLED_PINS = 24;
/** Simulation tick interval. 20 Hz is ample for the parts in this catalog. */
const SIMULATION_TICK_MS = 50;
/** Shortest press a momentary button reports: three ticks, as long as a quick tap. */
const MIN_PRESS_MS = 150;

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

@Component({
  selector: 'app-virtual-device-page',
  imports: [
    AddDeviceModal,
    CustomSelect,
    DeviceArt,
    DeviceInspector,
    RouterLink,
    SerialMonitorResize,
  ],
  templateUrl: './virtual-device.page.html',
  styleUrls: [
    './virtual-device.page.css',
    './virtual-device.devices.css',
    './device-inspector.css',
    './virtual-device.feedback.css',
    './virtual-device.serial.css',
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
  private readonly snapshotCache = inject(CanvasSnapshotCache);
  private readonly destroyRef = inject(DestroyRef);
  private readonly projectStore = inject(ProjectStore);
  private readonly preferences = inject(DevicePreferenceService);
  private readonly audio = inject(CircuitAudioService);
  private readonly canvasSvg = viewChild<ElementRef<SVGSVGElement>>('canvasSvg');
  private readonly canvasViewport = viewChild<ElementRef<HTMLElement>>('canvasViewport');
  private readonly addPartTrigger = viewChild<ElementRef<HTMLButtonElement>>('addPartTrigger');
  private readonly serialOutputRef = viewChild<ElementRef<HTMLElement>>('serialOutput');
  /**
   * Undo/redo over the editable circuit state.
   *
   * Snapshot-based: placements, connections, and device states are plain
   * records, so capturing them is cheap and every operation gets undo without
   * having to author an inverse.
   */
  private readonly history = new CircuitHistory<DevicePlacement, WireConnection, DeviceState>();
  protected readonly canUndo = signal(false);
  protected readonly canRedo = signal(false);

  private dragState: DragState | null = null;
  private wireCurveDragState: WireCurveDragState | null = null;
  private rotaryDragState: RotaryDragState | null = null;
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
  /**
   * The board is picked when the project is created and cannot be swapped
   * afterwards, so the Add Device picker lists everything except boards.
   */
  protected readonly libraryDevices = DEVICE_LIBRARY_ITEMS.filter(
    (device) => !isBoardCategory(device.categoryId),
  );
  /** Actuator geometry, so the press target is exactly the cap that is drawn. */
  protected readonly wireColors = WIRE_COLORS;
  protected readonly placements = signal<Record<string, DevicePlacement>>({
    ...INITIAL_PLACEMENTS,
  });
  protected readonly connections = signal<readonly WireConnection[]>([...INITIAL_CONNECTIONS]);
  protected readonly selectedDeviceId = signal<string | null>(null);
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
  protected readonly serialHeight = signal(224);
  protected readonly serialBaud = signal(115200);
  /** Rate the running sketch opened the port at, refreshed each tick. */
  protected readonly sketchBaud = signal(0);
  protected readonly baudOptions = SERIAL_BAUD_OPTIONS;
  protected readonly inspectorOpen = signal(false);
  protected readonly zoom = signal(1);
  protected readonly canvasPan = signal<Point>({ x: 0, y: 0 });
  protected readonly panning = signal(false);
  protected readonly canZoomOut = computed(() => this.zoom() > MIN_ZOOM);
  protected readonly canZoomIn = computed(() => this.zoom() < MAX_ZOOM);

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

  /** Configured values of the selected part, as the inspector edits them. */
  protected readonly selectedState = computed<DeviceState>(() => {
    const id = this.selectedDeviceId();
    return (id && this.deviceStates()[id]) || EMPTY_STATE;
  });

  /**
   * Live values the selected part is publishing, ready to print.
   *
   * Only the readings the part declares appear, and only while the simulation
   * runs: a value shown on a stopped board would be the last thing the circuit
   * did, read as though it were still doing it.
   */
  protected readonly selectedReadings = computed<
    readonly { id: string; label: string; value: string; description?: string }[]
  >(() => {
    const device = this.selectedDevice();
    if (!device?.readings?.length || !this.simulationRunning()) return [];

    const runtime = this.simulation().runtime[device.instanceId] ?? {};
    return device.readings
      .filter((reading) => runtime[reading.id] !== undefined)
      .map((reading) => ({
        id: reading.id,
        label: reading.label,
        description: reading.description,
        value: reading.unit ? `${runtime[reading.id]} ${reading.unit}` : `${runtime[reading.id]}`,
      }));
  });

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
          deltaMs,
        },
        this.behaviors,
      ),
    );

    // A short acts like the fuse on a real bench supply: the run stops rather
    // than carrying on with the error merely listed beside a working circuit.
    // The findings are captured first, because stopping clears the solve.
    const shorts = this.shortIssues();
    if (shorts.length) {
      this.shortTrip.set(shorts);
      this.toggleSimulation();
    }
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
      if (factory) this.behaviors.set(device.instanceId, factory(device.instanceId));
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
      this.firmware.pumpSerial();
      this.sketchBaud.set(this.firmware.sketchBaud());
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

  /**
   * Relay contacts as the last tick left them, so only a *change* clicks.
   *
   * Keyed by instance and channel, rebuilt each tick: a relay deleted mid-run
   * has to leave with its entry, or replacing it would click on arrival.
   */
  private contactPositions = new Map<string, boolean>();

  /**
   * Gives the noisy parts a voice.
   *
   * The audio service is told what should be sounding, never which part is
   * which: a relay is anything publishing a `chN` contact, a motor anything
   * publishing `spinning`, a pump anything publishing `pumping`, a buzzer
   * anything publishing `sounding` and the `toneHz` to sound it at. The runtime
   * values are the same ones the artwork already reads, so a part becomes
   * audible by emitting them rather than by being listed here.
   */
  private readonly audioEffect = effect(() => {
    const running = this.simulationRunning();
    const states = this.renderStates();

    if (!running) {
      this.audio.silence();
      this.contactPositions.clear();
      return;
    }

    const sustained: SustainedSound[] = [];
    const contacts = new Map<string, boolean>();

    for (const [instanceId, state] of Object.entries(states)) {
      const effort = typeof state['effort'] === 'number' ? state['effort'] : 0;
      // One voice per part: the chain is exclusive so a part that somehow
      // published two of these keys still gets a single, stable voice rather
      // than two fighting over the same id every tick.
      if (state['spinning'] === true) {
        sustained.push({ id: instanceId, kind: 'motor', intensity: effort });
      } else if (state['pumping'] === true) {
        sustained.push({ id: instanceId, kind: 'pump', intensity: effort });
      } else if (state['sounding'] === true) {
        sustained.push({
          id: instanceId,
          kind: 'buzzer',
          intensity: 1,
          hertz: typeof state['toneHz'] === 'number' ? state['toneHz'] : undefined,
        });
      }

      for (const [key, value] of Object.entries(state)) {
        if (typeof value !== 'boolean' || !RELAY_CONTACT_KEY.test(key)) continue;
        const contact = `${instanceId}:${key}`;
        contacts.set(contact, value);
        const before = this.contactPositions.get(contact);
        // An unknown previous position is the first tick of a run or a part
        // that has just appeared; neither is a contact throwing over.
        if (before !== undefined && before !== value) this.audio.click(value);
      }
    }

    this.contactPositions = contacts;
    this.audio.sustain(sustained);
  });

  /** True while the canvas is silenced; the preference survives a reload. */
  protected readonly soundMuted = this.audio.muted;

  protected toggleSound(): void {
    this.audio.toggleMuted();
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
        properties: this.deviceStates()[device.instanceId],
      })),
      connections: this.visibleConnections(),
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

    // The wires landing on those pins, so the canvas dashes the short itself
    // rather than only outlining the part it runs through.
    const connections = this.visibleConnections();
    const wiresOn = (instanceId: string, pinNames: readonly string[]) =>
      connections
        .filter((wire) =>
          [wire.start, wire.end].some(
            (end) =>
              end.type === 'device' && end.deviceId === instanceId && pinNames.includes(end.pinId),
          ),
        )
        .map((wire) => wire.id);

    return [...owners].map(([instanceId, pinNames]) => ({
      id: `short:${instanceId}:${pinNames.join('-')}`,
      code: 'live-short',
      severity: 'error' as const,
      title: 'ตรวจพบไฟลัดขณะจำลอง',
      detail: `ขา ${pinNames.join(', ')} อยู่บนจุดที่มีทั้งไฟเลี้ยงและกราวด์จ่ายพร้อมกัน ถ้าเป็นวงจรจริงจะเกิดกระแสลัดวงจร`,
      deviceIds: [instanceId],
      wireIds: wiresOn(instanceId, pinNames),
    }));
  });

  /**
   * The shorts that stopped the last run. Kept after the stop so the user sees
   * why the circuit went dead; cleared by the next Start.
   */
  protected readonly shortTrip = signal<readonly WireIssue[]>([]);

  protected readonly wireIssues = computed(() => {
    const dismissed = this.dismissedIssueIds();
    const shorts = this.simulationRunning() ? this.shortIssues() : this.shortTrip();
    return [...this.allIssues(), ...shorts].filter((issue) => !dismissed.has(issue.id));
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
      this.inspectorOpen.set(true);
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
    this.inspectorOpen.set(true);
  }

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
    () => !this.layoutLoading() && this.visibleDevices().length === 0 && !this.placingDeviceId(),
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
  protected readonly placedBoardCount = computed(
    () =>
      this.visibleDevices().filter((device) => isBoardCategory(device.catalog.categoryId)).length,
  );
  protected readonly placingDevice = computed(() => {
    const id = this.placingDeviceId();
    return id ? (deviceById(id) ?? null) : null;
  });
  protected readonly canvasScale = computed(() => BASE_CANVAS_SCALE * this.zoom());
  protected readonly canvasPixelWidth = computed(() => CANVAS_WIDTH * this.canvasScale());
  protected readonly canvasPixelHeight = computed(() => CANVAS_HEIGHT * this.canvasScale());
  protected readonly canvasViewBox = `0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`;

  /**
   * Dot grid, kept deliberately quiet.
   *
   * Spacing steps by powers of two so the dots stay roughly the same distance
   * apart on screen at any zoom. Without that they crowd into a grey wash when
   * zoomed out and drift apart into uselessness when zoomed in. The grid is a
   * hint about alignment, not something to look at.
   */
  private readonly gridLayers = computed(() => {
    const scale = this.canvasScale();
    const pan = this.canvasPan();

    // Aim for ~26 px between dots, snapping the multiplier to a power of two so
    // the pattern stays aligned with the snap grid at every zoom level.
    const steps = Math.round(Math.log2(26 / (GRID_SIZE * scale)));
    const spacing = GRID_SIZE * scale * Math.pow(2, Math.max(0, steps));

    return [
      {
        image: 'radial-gradient(circle, #cfd4da 0.9px, transparent 1px)',
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

  /** Route project id. Null only if the canvas is opened outside a project. */
  private readonly firmware = inject(FirmwareLoaderService);

  private readonly persistedProjectId =
    this.route.snapshot.paramMap.get('projectId') ??
    this.route.parent?.snapshot.paramMap.get('projectId') ??
    null;

  constructor() {
    const cached = this.persistedProjectId ? this.snapshotCache.get(this.persistedProjectId) : undefined;
    afterNextRender(() => {
      if (!cached) this.centerCanvasAtZoom(1);
    });

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
    }

    // Coming back to a project this session: draw it as it was left, at once,
    // and let the fetch below refresh it quietly.
    const shown = cached ? this.showCachedSnapshot(cached) : null;
    void this.restorePersistedComponents(shown);

    this.destroyRef.onDestroy(() => {
      // The ticker is a bare requestAnimationFrame loop and the firmware bus is
      // app-wide, so neither ends with the component. Left running, the old loop
      // keeps advancing this project's sketches from a canvas that is gone, and
      // the next visit adds a second loop on top: every machine is then stepped
      // twice a frame from two different node snapshots, which is what made a
      // working circuit start flickering after navigating away and back.
      this.stopTicker();
      this.firmware.stop();
      this.audio.silence();

      // A drag in progress when the user navigates away would otherwise be lost:
      // its write is still sitting in the debounce window.
      const projectId = this.persistedProjectId;
      if (projectId) {
        void this.canvasPersistence.flushAll(projectId);
        // Only a layout that actually loaded is worth drawing next time.
        if (!this.layoutLoading() && !this.layoutLoadFailed()) {
          this.snapshotCache.set(projectId, {
            instances: this.deviceInstances(),
            placements: this.placements(),
            deviceStates: this.deviceStates(),
            connections: this.connections(),
            junctions: this.wireJunctions(),
            zoom: this.zoom(),
            pan: this.canvasPan(),
          });
        }
      }
    });
  }

  /** Puts a remembered layout on screen and returns what was shown, to tell later edits apart. */
  private showCachedSnapshot(cached: CanvasSnapshot): CanvasSnapshotRefs {
    this.deviceInstances.set([...cached.instances]);
    this.placements.set({ ...cached.placements });
    this.deviceStates.set({ ...cached.deviceStates });
    this.connections.set([...cached.connections]);
    this.wireJunctions.set({ ...cached.junctions });
    this.zoom.set(cached.zoom);
    this.canvasPan.set(cached.pan);
    this.layoutLoading.set(false);
    return {
      placements: this.placements(),
      deviceStates: this.deviceStates(),
      connections: this.connections(),
    };
  }

  /**
   * Replaces the starter layout with whatever this project actually contains.
   *
   * A project created with a board already has that board stored, so it appears
   * here rather than the canvas opening empty after the user chose one.
   */
  private async restorePersistedComponents(shown: CanvasSnapshotRefs | null = null): Promise<void> {
    const projectId = this.persistedProjectId;
    if (!projectId) return;

    try {
      const [stored, storedConnections] = await Promise.all([
        this.canvasPersistence.load(projectId),
        this.canvasPersistence.loadConnections(projectId),
      ]);

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

      const connections = this.restoreConnections(
        storedConnections,
        new Set(Object.keys(placements)),
      );

      void this.refreshUsage();
      // The user started editing the remembered layout before this arrived. Their
      // edits are already on their way to the server; replacing the canvas now
      // would snap the part they are dragging back to where it was.
      if (
        shown &&
        (this.placements() !== shown.placements ||
          this.deviceStates() !== shown.deviceStates ||
          this.connections() !== shown.connections)
      ) {
        return;
      }
      this.deviceInstances.set(instances);
      this.placements.set(placements);
      this.deviceStates.set(states);
      this.connections.set(connections);
      this.layoutLoadFailed.set(false);
    } catch {
      // A remembered layout on screen is better than an error over it.
      if (!shown) this.layoutLoadFailed.set(true);
    } finally {
      this.layoutLoading.set(false);
    }
  }

  protected async retryLayout(): Promise<void> {
    if (!this.layoutLoadFailed() || this.layoutLoading()) return;
    this.layoutLoading.set(true);
    await this.restorePersistedComponents();
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

  protected canvasTransform(): string {
    const pan = this.canvasPan();
    return `translate(${pan.x}px, ${pan.y}px)`;
  }

  // ------------------------------------------------------- device properties

  /**
   * Property values for one instance, with any simulation output layered on
   * top. The artwork therefore draws configured values while stopped and live
   * values while running, from a single input.
   */
  /**
   * Last merge handed to the artwork, kept so an unchanged part keeps its object.
   *
   * DeviceArt rebuilds its entire shape list whenever this input changes
   * *reference*, so returning a fresh merge every time made every placed part
   * redraw on every change detection pass — a hover, a pan, each of the twenty
   * solves a second — whether or not a single value had moved.
   */
  private renderStateCache: Record<string, DeviceState> = {};

  private readonly renderStates = computed<Record<string, DeviceState>>(() => {
    const properties = this.deviceStates();
    const runtime = this.simulation().runtime;
    const previous = this.renderStateCache;
    const next: Record<string, DeviceState> = {};

    for (const device of this.visibleDevices()) {
      const id = device.instanceId;
      const base = properties[id] ?? EMPTY_STATE;
      const live = runtime[id];
      const merged = live ? { ...base, ...live } : base;
      const before = previous[id];
      next[id] = before && sameState(before, merged) ? before : merged;
    }

    this.renderStateCache = next;
    return next;
  });

  protected deviceStateFor(instanceId: string): DeviceState {
    return this.renderStates()[instanceId] ?? EMPTY_STATE;
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
    this.persistDeviceState(id);
  }

  protected setSelectedProperty(change: PropertyChange): void {
    const id = this.selectedDeviceId();
    const device = this.selectedDevice();
    if (!id || !device) return;
    this.deviceStates.update((states) => ({
      ...states,
      [id]: { ...(states[id] ?? defaultStateFor(device.properties)), [change.id]: change.value },
    }));
    this.persistDeviceState(id);
  }

  /**
   * Turns the selected part into another variant of itself, in place.
   *
   * The instance keeps its id, position and wires. A wire keeps its pin name when
   * the new variant has that pin, and otherwise moves to the pin in the same
   * position: an RGB LED's common leg is `CATH` on one polarity and `ANODE` on
   * the other, but it is the second leg on both.
   */
  protected async changeVariant(definitionId: string): Promise<void> {
    const current = this.selectedDevice();
    const next = deviceById(definitionId);
    if (!current || !next || current.id === next.id || this.simulationRunning()) return;
    const id = current.instanceId;

    const pinFor = (pinId: string): string => {
      if (next.pins.some((pin) => pin.name === pinId)) return pinId;
      return next.pins[current.pins.findIndex((pin) => pin.name === pinId)]?.name ?? pinId;
    };
    const moveEndpoint = (endpoint: WireEndpoint): WireEndpoint => {
      if (endpoint.type !== 'device' || endpoint.deviceId !== id) return endpoint;
      const pinId = pinFor(endpoint.pinId);
      return pinId === endpoint.pinId ? endpoint : { ...endpoint, pinId };
    };

    const moved: WireConnection[] = [];
    const connections = this.connections().map((wire) => {
      const start = moveEndpoint(wire.start);
      const end = moveEndpoint(wire.end);
      if (start === wire.start && end === wire.end) return wire;
      const rewired = { ...wire, start, end };
      moved.push(rewired);
      return rewired;
    });

    const previous = this.deviceStates()[id] ?? EMPTY_STATE;
    const state = defaultStateFor(next.properties);
    for (const property of next.properties ?? []) {
      if (previous[property.id] !== undefined) state[property.id] = previous[property.id];
    }

    this.deviceInstances.update((devices) =>
      devices.map((device) => (device.instanceId === id ? { ...next, instanceId: id } : device)),
    );
    this.deviceStates.update((states) => ({ ...states, [id]: state }));
    this.connections.set(connections);
    // Undo snapshots hold wires on the old variant's pin names, which the new
    // part does not have, so they can no longer be restored safely.
    this.history.clear();
    this.syncHistoryFlags();

    const projectId = this.persistedProjectId;
    if (!projectId) return;
    try {
      await this.canvasPersistence.changeDefinition(
        projectId,
        id,
        next.id,
        savedStateOf(next, state),
      );
      // A stored wire names its pins, so a moved wire is replaced rather than edited.
      for (const wire of moved) {
        await this.canvasPersistence.removeConnection(projectId, wire.id);
        await this.persistNewConnection(wire);
      }
    } catch {
      this.componentLimitMessage.set('บันทึกการเปลี่ยนชนิดอุปกรณ์ไม่สำเร็จ');
    }
  }

  /**
   * Queues the part's settings for saving.
   *
   * Values flagged `simulationOnly` are left out: the solver writes those back
   * every tick, and saving one would reopen the project with a relay latched on.
   */
  private persistDeviceState(id: string): void {
    const projectId = this.persistedProjectId;
    const device = this.deviceInstances().find((candidate) => candidate.instanceId === id);
    if (!projectId || !device) return;
    this.canvasPersistence.queueState(projectId, id, savedStateOf(device, this.deviceStates()[id]));
  }

  /** Hit target for one relay block, matching the drawn artwork exactly. */
  // --------------------------------------------------------------- selection

  protected selectDevice(id: string): void {
    this.selectedDeviceId.set(id);
    this.selectedWireId.set(null);
  }

  protected selectWire(event: Event, id: string): void {
    event.stopPropagation();
    this.selectedWireId.set(id);
    this.selectedDeviceId.set(null);
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
    this.selectedDeviceId.set(null);
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
    // Never steal a keystroke from a field the user is typing into.
    if (isTypingTarget(event.target)) return;

    const accel = event.ctrlKey || event.metaKey;

    if (accel && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }

    if (accel && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      event.stopPropagation();
      this.redo();
      return;
    }

    if (!accel && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      event.stopPropagation();
      this.rotateSelected();
      return;
    }

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

  /**
   * Re-lays every unrotated part into columns beside the board, the same layout
   * an applied assistant plan gets. The board and rotated parts stay put. Hand-drawn
   * bends are dropped from the wires that move, since they were drawn for the old
   * positions; a bend that is a junction is kept. One undo step reverts it all.
   */
  protected autoArrange(): void {
    if (this.simulationRunning()) return;
    const before = this.snapshot();
    const placements = this.placements();
    const parts = this.visibleDevices().map((device) => ({
      id: device.instanceId,
      definition: device,
      x: placements[device.instanceId].x,
      y: placements[device.instanceId].y,
      rotation: placements[device.instanceId].rotation,
    }));
    const wires = this.connections().flatMap((wire) =>
      wire.start.type === 'device' && wire.end.type === 'device'
        ? [
            {
              from: { componentId: wire.start.deviceId, pinId: wire.start.pinId },
              to: { componentId: wire.end.deviceId, pinId: wire.end.pinId },
            },
          ]
        : [],
    );
    const movable = parts
      .filter((part) => !isBoardCategory(part.definition.catalog.categoryId) && part.rotation === 0)
      .map((part) => part.id);

    const positions = layoutNewParts(parts, wires, movable);
    if (!positions.size) return;
    for (const [id, at] of positions) {
      this.updatePlacement(id, { x: Math.round(at.x), y: Math.round(at.y) });
    }

    const projectId = this.persistedProjectId;
    this.connections.update((connections) =>
      connections.map((wire) => {
        const touches = [wire.start, wire.end].some(
          (end) => end.type === 'device' && positions.has(end.deviceId),
        );
        if (!touches || !wire.waypoints.length || wire.waypoints.some((point) => point.junctionId)) {
          return wire;
        }
        if (projectId) this.canvasPersistence.queueWaypoints(projectId, wire.id, []);
        return { ...wire, waypoints: [] };
      }),
    );

    this.recordChange(before);
    this.fitCanvas();
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
    // Start inverted so the first device establishes the box; an empty canvas
    // falls back to a fixed frame below rather than to the retired demo board.
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

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

    // Nothing placed: hand back a screen-sized frame so "fit" centres the empty
    // canvas at a sane zoom instead of dividing by an infinite extent.
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };

    return { minX, minY, maxX, maxY };
  }

  // ----------------------------------------------------------- part dragging

  protected beginDeviceDrag(event: PointerEvent, id: string): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    // A running board is a wired board: moving a part would drag its wires with
    // it and invite edits to a circuit that is mid-tick. Selection still works,
    // so the inspector can be read while the simulation runs.
    if (this.simulationRunning()) {
      this.selectDevice(id);
      return;
    }
    if (this.placingDeviceId()) return;
    const point = this.svgPoint(event);
    if (!point) return;
    const placement = this.placementFor(id);
    this.selectDevice(id);
    // Opened here and committed on pointer-up, so the whole movement is one
    // undo step instead of one per frame.
    this.history.begin(this.snapshot());
    this.dragState = {
      deviceId: id,
      pointerId: event.pointerId,
      offset: { x: point.x - placement.x, y: point.y - placement.y },
    };
    (event.currentTarget as SVGElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  protected beginWireCurveDrag(event: PointerEvent, wireId: string, waypointIndex: number): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (this.simulationRunning()) return;
    this.selectedWireId.set(wireId);
    this.selectedDeviceId.set(null);
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
    if (this.rotaryDragState && event.pointerId === this.rotaryDragState.pointerId) {
      const state = this.rotaryDragState;
      const client = { x: event.clientX, y: event.clientY };
      this.scheduleFrame(() => this.continueRotaryDrag(state, client));
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
    if (this.rotaryDragState?.pointerId === event.pointerId) this.rotaryDragState = null;
    if (this.wireCurveDragState?.pointerId === event.pointerId) this.wireCurveDragState = null;
    if (this.dragState?.pointerId === event.pointerId) {
      this.dragState = null;
      // A click that moved nothing commits no entry: the history compares the
      // snapshots and discards a no-op gesture.
      this.history.commit(this.snapshot());
      this.syncHistoryFlags();
    }
  }

  protected handleDeviceKeydown(event: KeyboardEvent, id: string): void {
    // Same lock as the pointer path — the keyboard must not be a way around it.
    if (this.simulationRunning()) return;
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
    this.placingDeviceId.set(id);
    const device = deviceById(id);
    const viewport = this.canvasViewport()?.nativeElement;
    const bounds = viewport?.getBoundingClientRect();
    const center = bounds
      ? this.svgPointFromClient({
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        })
      : null;
    this.ghostPoint.set(
      device && center
        ? this.snapPoint({ x: center.x - device.width / 2, y: center.y - device.height / 2 })
        : null,
    );
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
    if (instanceId) this.selectDevice(instanceId);
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
    const distance = this.curveControlDistance(source, route[1]);
    const tangent = this.endpointOutwardVector(endpoint);
    const sourceControl = {
      x: source.x + tangent.x * distance,
      y: source.y + tangent.y * distance,
    };
    return this.curvedRoutePath(route, sourceControl);
  }

  /** Keeps a completed wire on the same smooth route shown while wiring. */
  protected wirePath(connection: WireConnection): string {
    const geometry = this.wireGeometry(connection);
    if (!geometry) return '';

    return this.curvedRoutePath(
      [geometry.source, ...this.resolvedWireWaypoints(connection), geometry.target],
      geometry.sourceControl,
      geometry.targetControl,
    );
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
    this.recordChange(this.snapshot());
    event.stopPropagation();
    this.removeWireWaypoint(wireId, waypointIndex);
  }

  protected addWireBend(event: MouseEvent, wireId: string): void {
    this.recordChange(this.snapshot());
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
    this.inspectorOpen.set(true);
  }

  protected wireHighlighted(connection: WireConnection): boolean {
    const selectedDeviceId = this.selectedDeviceId();
    return (
      connection.id === this.selectedWireId() ||
      (selectedDeviceId !== null && this.connectionHasDevice(connection, selectedDeviceId))
    );
  }

  protected devicePinOnSelectedWire(deviceId: string, pinId: string): boolean {
    return this.selectedWireHasEndpoint({ type: 'device', deviceId, pinId });
  }

  protected junctionOnSelectedWire(junctionId: string): boolean {
    return this.selectedWireHasEndpoint({ type: 'junction', junctionId });
  }

  protected pinConnected(deviceId: string, pinId: string): boolean {
    const endpoint: WireEndpoint = { type: 'device', deviceId, pinId };
    return this.connections().some((wire) => this.connectionHasEndpoint(wire, endpoint));
  }

  protected pinPending(deviceId: string, pinId: string): boolean {
    return this.endpointsEqual(this.pendingPin(), { type: 'device', deviceId, pinId });
  }

  protected devicePinCompatible(deviceId: string, pin: DevicePin): boolean {
    const pending = this.pendingPin();
    return pending
      ? this.endpointsCompatible(pending, { type: 'device', deviceId, pinId: pin.name })
      : false;
  }

  /**
   * Pins drawn a little larger, because they are the ones a beginner aims for.
   *
   * Boards that print their own pinout are excluded: emphasising a handful of
   * holes on a silkscreened header contradicts the labels beside them. Sparse
   * parts emphasise everything, since there is nothing to prioritise against.
   */
  protected importantDevicePin(device: DeviceInstance, pin: DevicePin): boolean {
    if (device.printsOwnPinLabels) return false;
    if (device.pins.length <= 6) return true;
    // A breadboard's rails are power and ground on every column, so the
    // power/ground rule below would paper the whole part in labels the moment
    // it is selected. Parts this dense disclose a name on hover only.
    if (device.pins.length > MAX_LABELLED_PINS) return false;
    return pin.kind === 'power' || pin.kind === 'ground' || pin.type === 'reset';
  }

  /** Rich pin description: name, classification, voltage, authored detail. */
  protected pinTooltip(pin: DevicePin): string {
    return pinTooltip(pin);
  }

  /**
   * Which edge a pin sits on, falling back to its position when the part did
   * not declare one. The label has to sit outboard of the part, so guessing
   * wrong would print it across the artwork.
   */
  private pinEdge(device: DeviceInstance, pin: DevicePin): 'left' | 'right' | 'top' | 'bottom' {
    if (pin.side) return pin.side;
    if (pin.y >= device.height) return 'bottom';
    if (pin.y <= 0) return 'top';
    return pin.x > device.width / 2 ? 'right' : 'left';
  }

  /** Label sits outboard of the pin, on whichever edge the pin belongs to. */
  protected pinLabelX(device: DeviceInstance, pin: DevicePin): number {
    const edge = this.pinEdge(device, pin);
    if (edge === 'bottom' || edge === 'top') return pin.x;
    return edge === 'right' ? pin.x - 12 : pin.x + 12;
  }

  protected pinLabelAnchor(device: DeviceInstance, pin: DevicePin): 'start' | 'middle' | 'end' {
    const edge = this.pinEdge(device, pin);
    if (edge === 'bottom' || edge === 'top') return 'middle';
    return edge === 'right' ? 'end' : 'start';
  }

  protected pinLabelY(device: DeviceInstance, pin: DevicePin): number {
    const edge = this.pinEdge(device, pin);
    if (edge === 'bottom') return pin.y + 16;
    if (edge === 'top') return pin.y - 10;
    return pin.y + 4;
  }

  protected devicePinPoint(device: DeviceInstance, pin: DevicePin): Point {
    return this.deviceLocalToCanvas(device, pin);
  }

  /** A point in a part's own drawing units, placed in canvas coordinates. */
  private deviceLocalToCanvas(device: DeviceInstance, local: Point): Point {
    const placement = this.placementFor(device.instanceId);
    const scale = this.renderScale(device);
    const center = { x: device.width / 2, y: device.height / 2 };
    const radians = (placement.rotation * Math.PI) / 180;
    const dx = local.x - center.x;
    const dy = local.y - center.y;
    // Mirrors deviceTransform exactly: rotate in drawing units, scale, translate.
    return {
      x: placement.x + scale * (center.x + dx * Math.cos(radians) - dy * Math.sin(radians)),
      y: placement.y + scale * (center.y + dx * Math.sin(radians) + dy * Math.cos(radians)),
    };
  }

  protected wireEndpointLabel(endpoint: WireEndpoint): string {
    if (endpoint.type === 'junction') return `Junction ${endpoint.junctionId}`;
    const device = this.deviceInstanceById(endpoint.deviceId);
    return `${device?.name ?? endpoint.deviceId}:${endpoint.pinId}`;
  }

  // ---------------------------------------------------------------- commands

  /** The state undo restores. Cheap enough to take on every recorded change. */
  private snapshot(): CircuitSnapshot<DevicePlacement, WireConnection, DeviceState> {
    return {
      placements: { ...this.placements() },
      connections: [...this.connections()],
      deviceStates: { ...this.deviceStates() },
    };
  }

  private applySnapshot(
    snapshot: CircuitSnapshot<DevicePlacement, WireConnection, DeviceState>,
  ): void {
    this.placements.set({ ...snapshot.placements });
    this.connections.set([...snapshot.connections]);
    this.deviceStates.set({ ...snapshot.deviceStates });
    this.syncHistoryFlags();
  }

  private syncHistoryFlags(): void {
    this.canUndo.set(this.history.canUndo);
    this.canRedo.set(this.history.canRedo);
  }

  /** Records a change that has already happened, given the state before it. */
  private recordChange(
    before: CircuitSnapshot<DevicePlacement, WireConnection, DeviceState>,
  ): void {
    this.history.record(before);
    this.syncHistoryFlags();
  }

  protected undo(): void {
    const restored = this.history.undo(this.snapshot());
    if (restored) this.applySnapshot(restored);
  }

  protected redo(): void {
    const restored = this.history.redo(this.snapshot());
    if (restored) this.applySnapshot(restored);
  }

  protected rotateSelected(): void {
    const before = this.snapshot();
    this.rotateSelectedInternal();
    this.recordChange(before);
  }

  private rotateSelectedInternal(): void {
    const id = this.selectedDeviceId();
    if (!id || this.simulationRunning()) return;
    const placement = this.placementFor(id);
    this.updatePlacement(id, { rotation: (placement.rotation + 90) % 360 });
  }

  /**
   * Screen position for the floating toolbar, in canvas coordinates.
   *
   * Anchored above the part rather than beside it, so it never sits over the
   * headers a user is trying to wire.
   */
  protected readonly selectionToolbarAt = computed(() => {
    const device = this.selectedDevice();
    if (!device) return null;

    const placement = this.placementFor(device.instanceId);
    const scale = this.renderScale(device);
    return {
      x: placement.x + (device.width * scale) / 2,
      y: placement.y - 14,
    };
  });

  /**
   * Places a copy of the selected part, offset so it does not land on top of
   * the original. Wires are not copied: a duplicate is a new component, and
   * silently inventing connections for it would be a surprise.
   */
  /**
   * Canvas coordinates to viewport pixels.
   *
   * The toolbar is HTML, not SVG, so it has to be placed in screen space while
   * following something positioned in canvas space.
   */

  protected canvasToScreenX(x: number): number {
    return x * this.canvasScale() + this.canvasPan().x;
  }

  protected canvasToScreenY(y: number): number {
    return y * this.canvasScale() + this.canvasPan().y;
  }

  protected duplicateSelected(): void {
    const device = this.selectedDevice();
    if (!device) return;

    const placement = this.placementFor(device.instanceId);
    const before = this.snapshot();
    const created = this.createDeviceInstance(device.id, {
      x: placement.x + GRID_SIZE * 2,
      y: placement.y + GRID_SIZE * 2,
    });
    if (!created) return;
    this.recordChange(before);
    this.selectDevice(created);
  }

  protected deleteSelection(): void {
    // A running circuit is edited only through part settings in the inspector;
    // removing a part or wire mid-run would pull hardware out from under the sketch.
    if (this.simulationRunning()) return;
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
    if (!deviceId) return;
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

  /** Compile state per board, surfaced in the toolbar. */
  protected readonly firmwareBoards = this.firmware.boards;
  protected readonly firmwareLoadError = this.firmware.loadError;
  protected readonly serialLines = this.firmware.serial;

  /**
   * What the monitor prints: the sketch's lines without the empty tail a closing
   * newline leaves behind.
   */
  protected readonly serialOutputLines = computed(() => {
    const lines = this.serialLines();
    return lines.length && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  });

  /**
   * The sketch's own rate when it differs from the monitor's.
   *
   * A real monitor at the wrong rate prints garbage; saying so is more useful
   * than silently showing text the hardware would not have produced.
   */
  protected readonly baudMismatch = computed(() => {
    const sketch = this.sketchBaud();
    return sketch && sketch !== this.serialBaud() ? sketch : null;
  });

  /** True while the reader is at the bottom, which is when new output may follow. */
  private serialFollow = true;

  private readonly serialScrollEffect = effect(() => {
    const lines = this.serialOutputLines();
    if (!this.serialFollow || !lines.length) return;
    const element = untracked(() => this.serialOutputRef())?.nativeElement;
    if (!element) return;
    // After the rows render, not before, or the scroll lands short of the tail.
    queueMicrotask(() => {
      element.scrollTop = element.scrollHeight;
    });
  });

  /** The first fault across the placed boards, which is the one worth showing. */
  protected readonly firmwareFault = computed(
    () => this.firmwareBoards().find((board) => board.fault)?.fault ?? null,
  );

  protected toggleSimulation(): void {
    const next = !this.simulationRunning();
    this.simulationRunning.set(next);
    if (next) {
      this.shortTrip.set([]);
      // Started before the sketch resolves: the circuit is simulated either way,
      // and the boards pick up their firmware on the tick after it arrives.
      void this.loadFirmware();
      // Still inside the click, which is the only moment a browser will open an
      // audio device that is not suspended.
      this.audio.prime();
      this.startTicker();
    } else {
      this.stopTicker();
      this.firmware.stop();
      this.sketchBaud.set(0);
      this.releaseSimulationControls();
    }
    this.pendingPin.set(null);
    this.wirePointer.set(null);
    this.pendingWireWaypoints.set([]);
  }

  private async loadFirmware(): Promise<void> {
    const projectId = this.persistedProjectId;
    if (!projectId) return;
    const boards = this.visibleDevices()
      .filter((device) => isBoardCategory(device.catalog.categoryId))
      .map((device) => ({ instanceId: device.instanceId, definition: device }));
    await this.firmware.start(projectId, boards);
  }

  /**
   * Returns every live control to its default when the simulation stops.
   *
   * Without this a cap held down at the moment Stop was pressed stays visibly
   * pressed on a dead board, and an energised relay keeps its channel lamp lit
   * — both claiming a state the stopped workspace is no longer computing.
   */
  private releaseSimulationControls(): void {
    this.deviceStates.update((states) => {
      const next: Record<string, DeviceState> = { ...states };
      for (const device of this.deviceInstances()) {
        const live = device.properties?.filter((property) => property.simulationOnly);
        if (!live?.length) continue;
        const current = states[device.instanceId];
        if (!current) continue;
        const released: Record<string, string | number | boolean> = { ...current };
        for (const property of live) released[property.id] = property.defaultValue;
        next[device.instanceId] = released;
      }
      return next;
    });
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
    if (this.simulationRunning()) return;
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

  protected updateSerialBaud(value: string): void {
    const baud = Number(value);
    if (Number.isInteger(baud)) this.serialBaud.set(baud);
  }

  protected toggleSerial(): void {
    this.serialOpen.update((open) => !open);
  }

  protected clearSerial(): void {
    this.firmware.clear();
  }

  /** Scrolling up pauses the follow; returning to the bottom resumes it. */
  protected trackSerialScroll(event: Event): void {
    const element = event.target as HTMLElement;
    this.serialFollow = element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
  }

  /** Firmware comes from the project's files, so the canvas alone cannot run any. */
  protected get insideProject(): boolean {
    return this.persistedProjectId !== null;
  }

  protected toggleInspector(): void {
    this.inspectorOpen.update((open) => !open);
  }

  /** Current value of the boolean property a hotspot drives. */
  protected hotspotActive(deviceId: string, hotspot: DeviceHotspot): boolean {
    return this.deviceStates()[deviceId]?.[hotspot.property] === true;
  }

  /**
   * Pointer press or release on an operable region of a part.
   *
   * A momentary hotspot follows the pointer, so it releases on pointerup and on
   * pointerleave — without the leave case a button dragged off stays stuck down.
   * A toggle hotspot ignores the release entirely and flips once per press.
   *
   * Nothing operates while the simulation is stopped: a cap that clicks on a
   * dead board would say the circuit does something it cannot do yet. The
   * template also drops pointer events on idle hotspots, so a press on the cap
   * reaches the part underneath and drags it instead.
   */
  protected pressHotspot(
    event: Event,
    deviceId: string,
    hotspot: DeviceHotspot,
    down: boolean,
  ): void {
    if (!this.simulationRunning()) return;
    // A shaft is turned, not pressed: it opens a drag on the way down and
    // ignores the release entirely.
    if (hotspot.mode === 'rotary') {
      if (down && event instanceof PointerEvent) this.beginRotaryDrag(event, deviceId, hotspot);
      return;
    }
    event.stopPropagation();
    if (hotspot.mode === 'toggle') {
      if (down) this.setHotspotValue(deviceId, hotspot, !this.hotspotActive(deviceId, hotspot));
      return;
    }

    // A mouse click can press and release inside one 50 ms tick, so the sketch
    // never sees the button down. A finger holds a switch for far longer; the
    // release waits until the press has lasted at least that long.
    const key = `${deviceId}:${hotspot.property}`;
    if (down) {
      this.pressedAt.set(key, performance.now());
      this.setHotspotValue(deviceId, hotspot, true);
      return;
    }
    const startedAt = this.pressedAt.get(key);
    if (startedAt === undefined) return;
    this.pressedAt.delete(key);
    const remaining = MIN_PRESS_MS - (performance.now() - startedAt);
    if (remaining <= 0) {
      this.setHotspotValue(deviceId, hotspot, false);
      return;
    }
    setTimeout(() => {
      // Pressed again meanwhile: that press owns the release now.
      if (!this.pressedAt.has(key)) this.setHotspotValue(deviceId, hotspot, false);
    }, remaining);
  }

  /** When each momentary hotspot went down, by `device:property`. */
  private readonly pressedAt = new Map<string, number>();

  /** Keyboard equivalent: a press-and-release cannot be expressed, so flip. */
  protected toggleHotspot(event: Event, deviceId: string, hotspot: DeviceHotspot): void {
    if (!this.simulationRunning()) return;
    if (hotspot.mode === 'rotary') return;
    event.stopPropagation();
    this.setHotspotValue(deviceId, hotspot, !this.hotspotActive(deviceId, hotspot));
  }

  /** Where a rotary hotspot currently sits, in the units of its own range. */
  protected rotaryValue(deviceId: string, hotspot: DeviceHotspot): number {
    const range = hotspot.range ?? { min: 0, max: 100 };
    const raw = this.deviceStates()[deviceId]?.[hotspot.property];
    const value = typeof raw === 'number' ? raw : range.min + (range.max - range.min) / 2;
    return Math.min(Math.max(value, range.min), range.max);
  }

  /**
   * Grabs a knob. The value is not written yet: a press alone must not jump the
   * shaft to wherever the user happened to click, or a click meant to select
   * the part would silently re-tune the circuit.
   */
  private beginRotaryDrag(event: PointerEvent, deviceId: string, hotspot: DeviceHotspot): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    const angle = this.rotaryPointerAngle(deviceId, hotspot, {
      x: event.clientX,
      y: event.clientY,
    });
    if (angle === null) return;

    this.selectDevice(deviceId);
    this.rotaryDragState = {
      pointerId: event.pointerId,
      deviceId,
      hotspot,
      lastAngle: angle,
      travel: this.rotaryTravel(deviceId, hotspot),
    };
    (event.currentTarget as SVGElement | null)?.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  /**
   * Turns the shaft by however far the pointer swept since the last sample.
   *
   * Following the pointer's absolute angle instead would make the shaft jump to
   * the far end whenever the pointer crossed the gap below the knob: past the
   * 135° stop the raw angle wraps through 180° and reads as the *other* stop, so
   * dragging left off the right-hand end snapped the value to zero. Accumulating
   * a wrapped-around delta keeps a stop a stop — the shaft sits there until the
   * pointer sweeps back the way it came.
   */
  private continueRotaryDrag(state: RotaryDragState, client: Point): void {
    const angle = this.rotaryPointerAngle(state.deviceId, state.hotspot, client);
    if (angle === null) return;

    const sweep = state.hotspot.sweep ?? 135;
    const range = state.hotspot.range ?? { min: 0, max: 100 };
    state.travel = Math.min(
      Math.max(state.travel + normalizeDegrees(angle - state.lastAngle), -sweep),
      sweep,
    );
    state.lastAngle = angle;

    const value = range.min + ((state.travel + sweep) / (sweep * 2)) * (range.max - range.min);
    this.setHotspotValue(state.deviceId, state.hotspot, Math.round(value));
  }

  /**
   * The pointer's bearing on a knob, in degrees clockwise from straight up —
   * the same zero the artwork rotates its indicator about.
   *
   * Measured in canvas space and then de-rotated by the part's own placement, so
   * a knob on a part rotated 90° still follows the pointer rather than lagging a
   * quarter turn behind it. Null when the pointer sits on the axis itself, where
   * a bearing means nothing.
   */
  private rotaryPointerAngle(
    deviceId: string,
    hotspot: DeviceHotspot,
    client: Point,
  ): number | null {
    const device = this.deviceInstanceById(deviceId);
    const region = hotspot.region;
    if (!device || region.kind !== 'circle') return null;

    const point = this.svgPointFromClient(client);
    if (!point) return null;
    const axis = this.deviceLocalToCanvas(device, { x: region.cx, y: region.cy });
    const dx = point.x - axis.x;
    const dy = point.y - axis.y;
    if (Math.hypot(dx, dy) < 0.01) return null;

    const bearing = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return normalizeDegrees(bearing - this.placementFor(deviceId).rotation);
  }

  /** Where the shaft stands now, as degrees either side of centre. */
  private rotaryTravel(deviceId: string, hotspot: DeviceHotspot): number {
    const range = hotspot.range ?? { min: 0, max: 100 };
    const sweep = hotspot.sweep ?? 135;
    const span = range.max - range.min;
    if (span <= 0) return 0;
    return ((this.rotaryValue(deviceId, hotspot) - range.min) / span) * sweep * 2 - sweep;
  }

  /** Keyboard equivalent of a turn: one step of travel per arrow press. */
  protected nudgeRotary(
    event: Event,
    deviceId: string,
    hotspot: DeviceHotspot,
    step: number,
  ): void {
    if (!this.simulationRunning() || hotspot.mode !== 'rotary') return;
    event.preventDefault();
    event.stopPropagation();
    const range = hotspot.range ?? { min: 0, max: 100 };
    const next = this.rotaryValue(deviceId, hotspot) + step * ((range.max - range.min) / 100);
    this.setHotspotValue(deviceId, hotspot, Math.min(Math.max(next, range.min), range.max));
  }

  /**
   * Writes through the part's own property state.
   *
   * That is the same state the inspector edits and the solver reads, so a cap
   * pressed on the canvas actually closes the contact rather than only looking
   * as though it had.
   */
  private setHotspotValue(deviceId: string, hotspot: DeviceHotspot, value: boolean | number): void {
    const device = this.deviceInstanceById(deviceId);
    if (!device?.properties?.some((property) => property.id === hotspot.property)) return;

    this.deviceStates.update((states) => ({
      ...states,
      [deviceId]: {
        ...(states[deviceId] ?? defaultStateFor(device.properties)),
        [hotspot.property]: value,
      },
    }));
  }

  protected resetDiagram(): void {
    this.deviceInstances.set([...INITIAL_DEVICE_INSTANCES]);
    this.placements.set({ ...INITIAL_PLACEMENTS });
    this.connections.set([...INITIAL_CONNECTIONS]);
    this.deviceStates.set(INITIAL_DEVICE_STATES);
    this.selectedDeviceId.set(null);
    this.selectedWireId.set(null);
    this.pendingPin.set(null);
    this.wirePointer.set(null);
    this.pendingWireWaypoints.set([]);
    this.cancelPlacement();
    this.wireJunctions.set({});
    this.junctionSequence = 0;
    this.deviceSequence = 0;
    this.fitCanvas();
  }

  protected handleEditorKeydown(event: KeyboardEvent): void {
    if (this.layoutLoading() || this.layoutLoadFailed()) return;
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

  private createDeviceInstance(kind: DeviceKind, origin: Point): string | null {
    const definition = deviceById(kind);
    if (
      definition &&
      isBoardCategory(definition.catalog.categoryId) &&
      this.placedBoardCount() >= MAX_BOARD_COUNT
    ) {
      this.componentLimitMessage.set(`A workspace can contain up to ${MAX_BOARD_COUNT} boards.`);
      return null;
    }

    // Reusing a hidden instance is only safe without persistence. With a project
    // behind the canvas, hiding a component deletes it server-side, so reviving
    // that id would resurrect a row that no longer exists.
    const reusable = this.persistedProjectId
      ? undefined
      : this.deviceInstances().find(
          (device) => device.id === kind && !this.placements()[device.instanceId]?.visible,
        );
    let instance = reusable;

    if (!instance) {
      const device = definition;
      if (!device) return null;
      let instanceId = `${kind}-${++this.deviceSequence}`;
      while (this.placements()[instanceId]) instanceId = `${kind}-${++this.deviceSequence}`;
      instance = { ...device, instanceId };
      this.deviceInstances.update((devices) => [...devices, instance!]);
    }

    this.placements.update((placements) => ({
      ...placements,
      [instance.instanceId]: { ...origin, rotation: 0, visible: true },
    }));
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
  private restoreConnections(
    stored: readonly CanvasConnection[],
    knownComponentIds: ReadonlySet<string>,
  ): WireConnection[] {
    return stored
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
  }

  /**
   * Maps a canvas endpoint onto the stored form.
   *
   * Only device pins can be stored: the fixed demo board and junctions have no
   * rows behind them, so a wire touching either is kept on the canvas but not
   * written. Returning null is how the caller learns that.
   */
  private storableEndpoint(endpoint: WireEndpoint): { componentId: string; pinId: string } | null {
    return endpoint.type === 'device'
      ? { componentId: endpoint.deviceId, pinId: endpoint.pinId }
      : null;
  }

  private async persistNewConnection(connection: WireConnection): Promise<void> {
    const projectId = this.persistedProjectId;
    if (!projectId) return;

    const from = this.storableEndpoint(connection.start);
    const to = this.storableEndpoint(connection.end);
    if (!from || !to) {
      this.componentLimitMessage.set('This wire is not saved: junction taps are not stored yet.');
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
      this.componentLimitMessage.set(refusal ? refusal.message : 'Could not save this connection');
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
      connections.map((wire) => (wire.id === localId ? { ...wire, id: serverId } : wire)),
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
      const refusal = asComponentLimitRefusal(error) ?? asBoardLimitRefusal(error);
      this.componentLimitMessage.set(refusal ? refusal.message : 'Could not save this device');
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
        device.instanceId === localId ? { ...device, instanceId: serverId } : device,
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
    const historyBefore = this.snapshot();
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
    this.inspectorOpen.set(true);

    this.recordChange(historyBefore);

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
    const waypoints = this.resolvedWireWaypoints(connection);
    const sourceControlDistance = this.curveControlDistance(source, waypoints[0] ?? target);
    const targetControlDistance = this.curveControlDistance(target, waypoints.at(-1) ?? source);
    const sourceTangent =
      connection.start.type === 'junction'
        ? this.unitVector(source, target)
        : this.endpointOutwardVector(connection.start);
    const targetTangent =
      connection.end.type === 'junction'
        ? this.unitVector(target, source)
        : this.endpointOutwardVector(connection.end);
    const sourceControl = {
      x: source.x + sourceTangent.x * sourceControlDistance,
      y: source.y + sourceTangent.y * sourceControlDistance,
    };
    const targetControl = {
      x: target.x + targetTangent.x * targetControlDistance,
      y: target.y + targetTangent.y * targetControlDistance,
    };
    return { source, sourceControl, targetControl, target };
  }

  /** Prevents a pin tangent from overshooting a nearby bend and forming a loop. */
  private curveControlDistance(anchor: Point, neighbour: Point): number {
    const segmentLength = Math.hypot(neighbour.x - anchor.x, neighbour.y - anchor.y);
    return Math.min(150, Math.max(12, segmentLength * 0.35), segmentLength * 0.5);
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
    if (endpoint.type === 'junction') return this.wireJunctions()[endpoint.junctionId] ?? null;
    const device = this.deviceInstanceById(endpoint.deviceId);
    const pin = device?.pins.find((candidate) => candidate.name === endpoint.pinId);
    return device && pin ? this.devicePinPoint(device, pin) : null;
  }

  private endpointKind(endpoint: WireEndpoint): ConnectionKind | null {
    if (endpoint.type === 'junction')
      return this.wireJunctions()[endpoint.junctionId]?.kind ?? null;
    return (
      this.deviceInstanceById(endpoint.deviceId)?.pins.find((pin) => pin.name === endpoint.pinId)
        ?.kind ?? null
    );
  }

  private endpointOutwardVector(endpoint: WireEndpoint): Point {
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

  private endpointVisible(endpoint: WireEndpoint): boolean {
    if (endpoint.type === 'junction') return Boolean(this.wireJunctions()[endpoint.junctionId]);
    return this.placements()[endpoint.deviceId]?.visible ?? false;
  }

  private unitVector(from: Point, to: Point): Point {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    return distance > 0
      ? { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance }
      : { x: 0, y: 0 };
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

/**
 * True when the event came from somewhere the user is entering text.
 *
 * Without this, pressing R while naming something would rotate the selected
 * device instead of typing the letter.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
