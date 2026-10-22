import type { DeviceKind } from '../../device-library.models';
import type { DevicePin, VirtualDevice } from '../../models/virtual-device.model';
import { booleanState, type DeviceDrawContext } from '../core/device-definition';
import { rectHotspot } from '../core/device-hotspots';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { WOKWI } from '../core/device-palette';
import { silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, group, rect, repeat, text, type Shape } from '../core/device-shape';
import {
  isLogicHigh,
  propertyBoolean,
  propertyString,
  supplyVolts,
  type DeviceBehavior,
  type NodeState,
} from '../core/device-simulation';

/**
 * Opto-isolated relay modules, 1 to 8 channels.
 *
 * The SRD-05VDC-SL-C relay can is 19 × 15.5 mm and it is the same can on every
 * one of these boards — which is exactly why the boards are the sizes they are.
 * A single channel fits on 50 × 26 mm with the relay lying along the board; from
 * two channels up the cans stand on end in a row, which is how eight of them fit
 * across 149 mm. Deriving each board's width from the can rather than typing it
 * keeps that relationship true.
 */

type RelayDeviceKind = 'relay' | 'relay2' | 'relay4' | 'relay8';
type RelayChannelCount = 1 | 2 | 4 | 8;

const CHANNEL_ALIASES: Readonly<Record<RelayChannelCount, string>> = {
  1: 'single relay',
  2: 'dual relay',
  4: 'quad relay',
  8: 'eight relay',
};

/** SRD relay can, long side first. */
const CAN_LONG = u(19);
const CAN_SHORT = u(15.5);
/** Centre-to-centre spacing of the cans on a multi-channel board. */
const CHANNEL_PITCH = u(17);

/** Single-channel boards are the one layout that lies the relay on its side. */
function isCompact(channels: RelayChannelCount): boolean {
  return channels === 1;
}

function boardWidth(channels: RelayChannelCount): number {
  // 6.5 mm each side keeps the outer terminal blocks clear of the corner holes.
  return isCompact(channels) ? u(55) : Math.max(u(51), u(13) + channels * CHANNEL_PITCH);
}

function boardHeight(channels: RelayChannelCount): number {
  // Every multi-channel board shares one layout — terminals, standing cans, a status
  // pill under each can, then the control header — so they share one height.
  return isCompact(channels) ? u(26) : u(55);
}

/** Centre of channel `index` along the board's long axis. */
function channelCentreX(channels: RelayChannelCount, index: number): number {
  if (isCompact(channels)) return u(30);
  const span = channels * CHANNEL_PITCH;
  return (boardWidth(channels) - span) / 2 + CHANNEL_PITCH / 2 + index * CHANNEL_PITCH;
}

/**
 * Bounds of one relay can, in device coordinates.
 *
 * Shared by the artwork and by the canvas hit target so the clickable area is
 * always exactly the thing that looks clickable.
 */
export function relayChannelBox(
  channels: number,
  index: number,
): { x: number; y: number; width: number; height: number } {
  const count = channels as RelayChannelCount;
  if (isCompact(count)) {
    return { x: u(22.4), y: u(5.25), width: CAN_LONG, height: CAN_SHORT };
  }
  return {
    x: channelCentreX(count, index) - CAN_SHORT / 2,
    y: u(13),
    width: CAN_SHORT,
    height: CAN_LONG,
  };
}

/**
 * The three poles of one channel's terminal block, in the order they are printed.
 *
 * `COM` is the pole the load hangs off; the coil moves it from `NC` to `NO`.
 */
export const TERMINAL_POLES = ['NO', 'COM', 'NC'] as const;
export type TerminalPole = (typeof TERMINAL_POLES)[number];

const TERMINAL_DESCRIPTIONS: Readonly<Record<TerminalPole, (channel: number) => string>> = {
  NO: (channel) => `Channel ${channel} normally open — closes to COM when energised`,
  COM: (channel) => `Channel ${channel} common pole — wire the load here`,
  NC: (channel) => `Channel ${channel} normally closed — open when energised`,
};

/**
 * Geometry of one terminal block, shared by the artwork and the pins.
 *
 * A single source for both is what keeps a pin under the screw it belongs to. The
 * numbers are the same ones `draw` passes to `screwTerminal`, so moving a block moves
 * its pins with it.
 */
function terminalBlock(
  channels: RelayChannelCount,
  index: number,
): { x: number; y: number; width: number; height: number; vertical: boolean } {
  if (isCompact(channels)) {
    // Between the two right-hand mounting holes rather than over them.
    return { x: u(45), y: u(5.4), width: u(8), height: u(15.2), vertical: true };
  }
  const box = relayChannelBox(channels, index);
  return {
    x: box.x - u(0.5),
    y: u(0.5),
    width: CAN_SHORT + u(1),
    height: u(11),
    vertical: false,
  };
}

/** Centre of one screw, which is where its pin sits. */
function terminalPoint(
  channels: RelayChannelCount,
  index: number,
  pole: number,
): { x: number; y: number } {
  const block = terminalBlock(channels, index);
  const poles = TERMINAL_POLES.length;

  if (block.vertical) {
    const step = block.height / poles;
    return {
      x: block.x + block.width / 2,
      y: block.y + pole * step + step / 2,
    };
  }

  const step = block.width / poles;
  return {
    x: block.x + pole * step + step / 2,
    y: block.y + block.height / 2,
  };
}

/** Screw terminal block: three poles for NO, COM and NC. */
function screwTerminal(
  x: number,
  y: number,
  width: number,
  height: number,
  poles: number,
  vertical: boolean,
): readonly Shape[] {
  const step = (vertical ? height : width) / poles;
  return [
    rect(x, y, width, height, {
      rx: u(0.4),
      fill: WOKWI.terminal,
      stroke: WOKWI.terminalEdge,
      strokeWidth: u(0.2),
    }),
    ...repeat(
      poles,
      { x: vertical ? 0 : step, y: vertical ? step : 0 },
      (_, poleX, poleY) => {
        const cx = vertical ? x + width / 2 : poleX + step / 2;
        const cy = vertical ? poleY + step / 2 : y + height / 2;
        return [
          circle(cx, cy, u(1.6), {
            fill: WOKWI.usb,
            stroke: WOKWI.shieldEdge,
            strokeWidth: u(0.15),
            detail: 'normal',
          }),
          // Slot in the screw head.
          rect(cx - u(1.1), cy - u(0.2), u(2.2), u(0.4), {
            fill: WOKWI.espBoardTrace,
            detail: 'normal',
          }),
        ];
      },
      { x, y },
    ),
  ];
}

/** The relay can itself, energised or at rest. */
function relayCan(
  box: { x: number; y: number; width: number; height: number },
  energised: boolean,
  vertical: boolean,
): readonly Shape[] {
  return [
    rect(box.x, box.y, box.width, box.height, {
      rx: u(0.5),
      fill: energised ? WOKWI.relayCanActive : WOKWI.relayCan,
      stroke: energised ? WOKWI.antenna : WOKWI.relayBoardEdge,
      strokeWidth: energised ? u(0.3) : u(0.2),
    }),
    // Moulding seam around the lid.
    rect(box.x + u(0.8), box.y + u(0.8), box.width - u(1.6), box.height - u(1.6), {
      rx: u(0.3),
      fill: 'none',
      stroke: WOKWI.relayBoardEdge,
      strokeWidth: u(0.12),
      opacity: 0.7,
      detail: 'normal',
    }),
    text(box.x + box.width / 2, box.y + box.height / 2 + u(0.5), 'SRD-05VDC', {
      size: u(1.1),
      fill: WOKWI.label,
      anchor: 'middle',
      weight: 600,
      mono: true,
      rotate: vertical ? -90 : 0,
      detail: 'normal',
    }),
    ...(energised
      ? [
          rect(
            vertical ? box.x + box.width - u(0.7) : box.x + u(0.7),
            vertical ? box.y + u(0.7) : box.y + box.height - u(0.7),
            vertical ? u(0.28) : box.width - u(1.4),
            vertical ? box.height - u(1.4) : u(0.28),
            { rx: u(0.14), fill: WOKWI.antenna },
          ),
        ]
      : []),
  ];
}

/**
 * Accessible channel indicator: colour, text and channel number all agree.
 *
 * `vertical` stands the pill on end with its lamp at the top, reading top to
 * bottom.
 */
function channelStatus(
  cx: number,
  cy: number,
  channel: number,
  energised: boolean,
  vertical = false,
): readonly Shape[] {
  const width = u(13.4);
  const height = u(3.8);
  const active = WOKWI.ledRed;
  const inactive = WOKWI.pinLead;

  const shapes: Shape[] = [
    rect(cx - width / 2, cy - height / 2, width, height, {
      rx: height / 2,
      fill: WOKWI.espBoard,
      stroke: energised ? active : WOKWI.espBoardTrace,
      strokeWidth: u(0.16),
    }),
    circle(cx - u(4.9), cy, u(1.05), {
      fill: energised ? active : WOKWI.ledRedOff,
      stroke: WOKWI.buttonEdge,
      strokeWidth: u(0.12),
    }),
    text(cx - u(3.25), cy + u(0.35), `CH${channel}`, {
      size: u(0.86),
      fill: WOKWI.label,
      anchor: 'start',
      mono: true,
      weight: 700,
    }),
    text(cx + u(5.65), cy + u(0.35), energised ? 'ON' : 'OFF', {
      size: u(0.86),
      fill: energised ? active : inactive,
      anchor: 'end',
      mono: true,
      weight: 800,
    }),
  ];
  return vertical ? [group(shapes, { transform: `rotate(90 ${cx} ${cy})` })] : shapes;
}

/** Wokwi-style control header: dark plastic housing, gold posts and exposed leads. */
function controlHeader(
  padPoints: readonly { x: number; y: number }[],
  pinPoints: readonly { x: number; y: number }[],
  vertical: boolean,
): readonly Shape[] {
  const first = padPoints[0];
  const last = padPoints[padPoints.length - 1];

  return [
    ...padPoints.map((pad, index) => {
      const tip = pinPoints[index];
      return vertical
        ? rect(tip.x, pad.y - u(0.28), pad.x - tip.x, u(0.56), {
            rx: u(0.12),
            fill: WOKWI.pinLead,
          })
        : rect(pad.x - u(0.28), pad.y, u(0.56), tip.y - pad.y, {
            rx: u(0.12),
            fill: WOKWI.pinLead,
          });
    }),
    rect(
      vertical ? first.x - u(1.25) : first.x - HEADER_PITCH / 2,
      vertical ? first.y - HEADER_PITCH / 2 : first.y - u(1.25),
      vertical ? u(2.5) : last.x - first.x + HEADER_PITCH,
      vertical ? last.y - first.y + HEADER_PITCH : u(2.5),
      {
        rx: u(0.2),
        fill: WOKWI.chip,
        stroke: WOKWI.espBoardEdge,
        strokeWidth: u(0.1),
      },
    ),
    ...padPoints.map((pad) =>
      rect(pad.x - u(0.43), pad.y - u(0.43), u(0.86), u(0.86), {
        rx: u(0.08),
        fill: WOKWI.gold,
        stroke: WOKWI.goldEdge,
        strokeWidth: u(0.08),
      }),
    ),
  ];
}

function powerIndicator(cx: number, cy: number, powered: boolean): readonly Shape[] {
  return [
    circle(cx, cy, u(0.85), { fill: WOKWI.espBoardEdge }),
    circle(cx, cy, u(0.52), {
      fill: powered ? WOKWI.ledRed : WOKWI.ledRedOff,
      stroke: WOKWI.buttonEdge,
      strokeWidth: u(0.08),
    }),
    text(cx + u(1.25), cy + u(0.3), 'PWR', {
      size: u(0.72),
      fill: WOKWI.label,
      weight: 700,
      mono: true,
      detail: 'normal',
    }),
  ];
}

function createRelayDevice(
  id: RelayDeviceKind,
  channels: RelayChannelCount,
  x: number,
  y: number,
  initiallyVisible: boolean,
): VirtualDevice {
  const relayChannels = Array.from({ length: channels }, (_, index) => index + 1);
  const compact = isCompact(channels);
  const width = boardWidth(channels);
  const height = boardHeight(channels);

  const channelPinName = (channel: number) => (channels === 1 ? 'IN' : `IN${channel}`);

  // Control header: VCC and GND, then one input per channel. On a compact board
  // it stands on the left edge; otherwise it runs along the bottom.
  const headerCount = channels + 2;
  // Pads sit on the board edge; the pin itself is the tip of the lead, clear of
  // the artwork, so a wire reaches it without crossing the board.
  // The bottom header starts far enough in that its housing clears the
  // bottom-left mounting hole.
  const headerX = compact ? u(3) : u(7.5);
  const headerY = compact ? height / 2 - (HEADER_PITCH * (headerCount - 1)) / 2 : height - u(3);
  // Bottom leads run well past the board edge, so a pin tip is never crowded
  // against the header or the hole beside it.
  const LEAD_LENGTH = compact ? u(4.4) : u(7);

  function padPoint(index: number): { x: number; y: number } {
    return compact
      ? { x: headerX, y: headerY + index * HEADER_PITCH }
      : { x: headerX + index * HEADER_PITCH, y: headerY };
  }

  function headerPoint(index: number): { x: number; y: number } {
    const pad = padPoint(index);
    return compact ? { x: pad.x - LEAD_LENGTH, y: pad.y } : { x: pad.x, y: pad.y + LEAD_LENGTH };
  }

  const terminalPinName = (pole: TerminalPole, channel: number) =>
    channels === 1 ? pole : `${pole}${channel}`;

  const pins: DevicePin[] = [
    pin('VCC', headerPoint(0).x, headerPoint(0).y, 'vcc', {
      side: compact ? 'left' : 'bottom',
      description: 'Coil and logic supply, 5 V',
      voltage: 5,
    }),
    pin('GND', headerPoint(1).x, headerPoint(1).y, 'gnd', {
      side: compact ? 'left' : 'bottom',
      description: 'Ground reference',
    }),
    ...relayChannels.map((channel, index) => {
      const point = headerPoint(index + 2);
      return pin(channelPinName(channel), point.x, point.y, 'digital', {
        side: compact ? 'left' : 'bottom',
        description: `Channel ${channel} trigger. Active low by default; set the trigger to HIGH for a module jumpered active high.`,
      });
    }),

    // The switched side. These are dry contacts: isolated from the coil, with no
    // polarity and no logic level, which is exactly what `passive` describes — they
    // will join a supply, a ground, or a signal, because a relay does not care what
    // it switches. Without them the terminal block was drawn but could not be wired,
    // so the part could not actually switch anything.
    ...relayChannels.flatMap((channel, index) =>
      TERMINAL_POLES.map((pole, poleIndex) => {
        const point = terminalPoint(channels, index, poleIndex);
        return pin(terminalPinName(pole, channel), point.x, point.y, 'passive', {
          side: compact ? 'right' : 'top',
          description: TERMINAL_DESCRIPTIONS[pole](channel),
        });
      }),
    ),
  ];

  function statusBox(index: number): { x: number; y: number; width: number; height: number } {
    // A pill lies across its relay can's short side: horizontal under each
    // standing can, and on end on the single-channel board, where the can lies
    // down and the pill stands between the pin names and the can.
    if (compact) {
      return { x: u(14.7) - u(1.9), y: height / 2 - u(6.7), width: u(3.8), height: u(13.4) };
    }
    const cx = channelCentreX(channels, index);
    const cy = height - u(15.5);
    return { x: cx - u(6.7), y: cy - u(1.9), width: u(13.4), height: u(3.8) };
  }

  function draw(context: DeviceDrawContext): readonly Shape[] {
    const energised = relayChannels.map((channel) => booleanState(context, `ch${channel}`, false));
    const padPoints = Array.from({ length: headerCount }, (_, index) => padPoint(index));
    const headerPoints = Array.from({ length: headerCount }, (_, index) => headerPoint(index));

    const terminals = relayChannels.flatMap((_, index) => {
      const block = terminalBlock(channels, index);
      return screwTerminal(
        block.x,
        block.y,
        block.width,
        block.height,
        TERMINAL_POLES.length,
        block.vertical,
      );
    });

    const cans = relayChannels.flatMap((_, index) =>
      relayCan(relayChannelBox(channels, index), energised[index], !compact),
    );

    // One accessible status pill per channel: LED colour, state text and channel
    // number all communicate the same state.
    const control = relayChannels.flatMap((channel, index) => {
      const box = statusBox(index);
      return channelStatus(
        box.x + box.width / 2,
        box.y + box.height / 2,
        channel,
        energised[index],
        compact,
      );
    });

    const terminalLabels = relayChannels.flatMap((_, index) => {
      const block = terminalBlock(channels, index);
      return TERMINAL_POLES.map((pole, poleIndex) => {
        const point = terminalPoint(channels, index, poleIndex);
        return text(
          compact ? block.x - u(0.7) : point.x,
          compact ? point.y + u(0.3) : block.y + block.height + u(0.8),
          pole,
          {
            size: u(0.68),
            fill: WOKWI.label,
            anchor: compact ? 'end' : 'middle',
            mono: true,
            weight: 700,
            detail: 'normal',
          },
        );
      });
    });

    return [
      rect(0, 0, width, height, {
        rx: u(0.8),
        fill: WOKWI.relayBoard,
        stroke: WOKWI.relayBoardEdge,
        strokeWidth: u(0.2),
      }),
      rect(u(0.3), u(0.3), width - u(0.6), height - u(0.6), {
        rx: u(0.55),
        fill: 'none',
        stroke: WOKWI.relayBoardTrace,
        strokeWidth: u(0.1),
        detail: 'normal',
      }),
      // Flat plated mounting holes, matching the Wokwi board artwork.
      ...[
        [u(2.6), u(2.6)],
        [width - u(2.6), u(2.6)],
        [u(2.6), height - u(2.6)],
        [width - u(2.6), height - u(2.6)],
      ].flatMap(([holeX, holeY]) => [
        circle(holeX, holeY, u(2.3), {
          fill: WOKWI.relayBoardEdge,
          stroke: WOKWI.espBoardEdge,
          strokeWidth: u(0.14),
          detail: 'normal',
        }),
        circle(holeX, holeY, u(1.55), {
          fill: WOKWI.pinLead,
          detail: 'normal',
        }),
        circle(holeX, holeY, u(0.9), {
          fill: WOKWI.espBoardEdge,
          detail: 'normal',
        }),
      ]),

      ...terminals,
      ...terminalLabels,
      ...cans,
      ...control,
      // On the single-channel board the PWR lamp sits above the pin header, clear
      // of the standing status pill; on the others it is by the bottom header.
      ...powerIndicator(
        compact ? u(4.5) : width - u(8),
        compact ? u(6.6) : height - u(5),
        context.running && context.state['powered'] === true,
      ),

      // Control header: plastic housing, gold posts, and metal leads.
      ...controlHeader(padPoints, headerPoints, compact),
      ...pins.slice(0, headerCount).map((headerPin, index) => {
        const point = padPoint(index);
        return text(
          compact ? point.x + u(2.2) : point.x,
          // High enough that VCC clears the bottom-left mounting hole.
          compact ? point.y + u(0.4) : point.y - u(2.4),
          headerPin.name,
          {
            size: u(1),
            fill: WOKWI.label,
            anchor: compact ? 'start' : 'middle',
            mono: true,
            weight: 600,
            detail: 'normal',
          },
        );
      }),

      // Board name, on whatever strip of bare solder mask each layout leaves.
      silkLabel(
        compact ? u(30) : width / 2,
        compact ? u(24.4) : u(12.4),
        `${channels}CH RELAY 5V`,
        { size: u(1.1), fill: WOKWI.label, detail: 'high' },
      ),
    ];
  }

  return {
    id: id as DeviceKind,
    name: `${channels}-channel relay`,
    model: `SRD-05VDC-SL-C · ${channels} channel`,
    description: `Controls ${channels} isolated load${
      channels === 1 ? '' : 's'
    } using NO, COM and NC terminals.`,
    x,
    y,
    width,
    height,
    physicalSize: { widthMm: width / 10, heightMm: height / 10 },
    relayChannels,
    initiallyVisible,
    operatingVoltage: { min: 4.5, max: 5.5, recommended: 5 },
    interfaces: ['digital', 'power'],
    properties: [
      {
        id: 'trigger',
        label: 'สั่งงานด้วย',
        kind: 'select' as const,
        defaultValue: 'low',
        group: 'electrical' as const,
        options: [
          { value: 'low', label: 'LOW' },
          { value: 'high', label: 'HIGH' },
        ],
        description:
          'LOW: รีเลย์ทำงานเมื่อขา IN เป็น LOW แบบโมดูลทั่วไป · HIGH: สำหรับโมดูลที่ตั้งจัมเปอร์ H',
      },
      ...relayChannels.map((channel) => ({
        id: `ch${channel}`,
        label: channels === 1 ? 'ต่อวงจร' : `ช่อง ${channel}`,
        kind: 'boolean' as const,
        defaultValue: false,
        group: 'simulation' as const,
        // The solver writes this back every tick, so it drops to its default when
        // the simulation stops rather than leaving a dead board showing a lit
        // channel lamp.
        simulationOnly: true,
        description: `Energises the channel ${channel} coil, switching COM from NC to NO.`,
      })),
    ],
    pins,
    // Both the relay can and its status pill toggle the channel, so the most
    // obvious visual controls are also the easiest targets to click.
    hotspots: relayChannels.flatMap((channel, index) => [
      rectHotspot(`ch${channel}`, `Toggle ${id} channel ${channel}`, `ch${channel}`, {
        ...relayChannelBox(channels, index),
        rx: u(0.4),
      }),
      rectHotspot(
        `ch${channel}-status`,
        `Toggle ${id} channel ${channel} from status indicator`,
        `ch${channel}`,
        { ...statusBox(index), rx: u(1.9) },
      ),
    ]),
    render: {
      draw,
      bleed: compact ? { left: u(5) } : { bottom: u(5) },
    },
    simulation: () => createRelayBehavior(channels),
    catalog: {
      categoryId: 'relay-modules',
      category: 'Relay Modules',
      aliases: [CHANNEL_ALIASES[channels], 'switch module', `${channels} channel relay`],
      tags: ['relay', 'switch', 'isolated', 'load', 'output', '5V', 'automation'],
      interfaceLabel: `ทริกเกอร์ดิจิทัล · ${channels + 2} ขา`,
      typicalUsage:
        channels === 1
          ? 'Switching one lamp, fan, pump, or other isolated load.'
          : `Grouped switching for up to ${channels} isolated appliances.`,
    },
  };
}

/**
 * True when a trigger input at this level energises the coil.
 *
 * Most of these modules are opto-isolated and **active low**: the input LED
 * conducts when the pin is pulled down, so `digitalWrite(pin, LOW)` closes the
 * contact. It reads backwards the first time and it is what the hardware does.
 * Boards with an H/L jumper set to H invert that, which is the `activeHigh` case.
 */
export function coilEnergisedBy(node: NodeState, activeHigh = false): boolean {
  return isLogicHigh(node) === activeHigh;
}

/**
 * The switching behaviour.
 *
 * Two things force the shape of this. `connect` is the only pass where `bond` has an
 * effect, and it runs with reads disabled — so the contact position cannot be decided
 * from the input pin in the same pass that acts on it. The coil state therefore lives
 * on the behaviour instance: `update` reads the trigger, `connect` acts on what it
 * found. The resulting one-tick lag is not a workaround so much as the truth about a
 * relay, which takes several milliseconds to pull in.
 *
 * When nothing is wired to a trigger the manual toggle takes over, so clicking the can
 * on the canvas still works exactly as it did before this part could be driven.
 *
 * Either way the coil needs its own supply first. An unpowered module cannot pull in
 * however hard the trigger is driven, so with VCC or GND missing every channel rests
 * on NC — the same failure a bench build shows when the module is wired for signal but
 * not for power.
 */
function createRelayBehavior(channels: RelayChannelCount): DeviceBehavior {
  const relayChannels = Array.from({ length: channels }, (_, index) => index + 1);
  const inputName = (channel: number) => (channels === 1 ? 'IN' : `IN${channel}`);
  const poleName = (pole: TerminalPole, channel: number) =>
    channels === 1 ? pole : `${pole}${channel}`;

  let energised = relayChannels.map(() => false);

  return {
    connect(context) {
      for (const [index, channel] of relayChannels.entries()) {
        // COM always rests on one pole or the other; a relay contact is a changeover,
        // never open on both sides.
        context.bond(poleName('COM', channel), poleName(energised[index] ? 'NO' : 'NC', channel));
      }
    },
    update(context) {
      // Both rails have to reach the same supply, and the difference across them
      // has to be enough to hold the armature in — the module's own 4.5 V minimum.
      const powered = supplyVolts(context) >= 4.5;
      // The PWR lamp shows this, not whether the simulation happens to be running.
      context.emit('powered', powered);

      for (const [index, channel] of relayChannels.entries()) {
        if (!powered) {
          energised[index] = false;
          context.emit(`ch${channel}`, false);
          continue;
        }

        const trigger = context.readNode(inputName(channel));
        energised[index] = trigger.floating
          ? propertyBoolean(context, `ch${channel}`, false)
          : coilEnergisedBy(trigger, propertyString(context, 'trigger', 'low') === 'high');

        context.emit(`ch${channel}`, energised[index]);
      }
    },
    reset() {
      energised = relayChannels.map(() => false);
    },
  };
}

export const RELAY_1CH = createRelayDevice('relay', 1, 54, 430, true);
export const RELAY_2CH = createRelayDevice('relay2', 2, 84, 410, false);
export const RELAY_4CH = createRelayDevice('relay4', 4, 144, 370, false);
export const RELAY_8CH = createRelayDevice('relay8', 8, 174, 270, false);
