import type { DeviceKind } from '../../device-library.models';
import type { DevicePin, VirtualDevice } from '../../models/virtual-device.model';
import { booleanState, type DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { PART, PCB, SILK } from '../core/device-palette';
import { chip, indicatorLed, maleHeader, mountingHole, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, rect, repeat, text, type Shape } from '../core/device-shape';

/**
 * Opto-isolated relay modules, 1 to 8 channels.
 *
 * The SRD-05VDC-SL-C relay can is 19 × 15.5 mm and it is the same can on every
 * one of these boards — which is exactly why the boards are the sizes they are.
 * A single channel fits on 50 × 26 mm with the relay lying along the board; from
 * two channels up the cans stand on end in a row, which is how eight of them fit
 * across 144 mm. Deriving each board's width from the can rather than typing it
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
  return isCompact(channels) ? u(55) : Math.max(u(51), u(8) + channels * CHANNEL_PITCH);
}

function boardHeight(channels: RelayChannelCount): number {
  if (isCompact(channels)) return u(26);
  return channels === 2 ? u(39) : u(55);
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
    return { x: u(20), y: u(4.5), width: CAN_LONG, height: CAN_SHORT };
  }
  return {
    x: channelCentreX(count, index) - CAN_SHORT / 2,
    y: u(13),
    width: CAN_SHORT,
    height: CAN_LONG,
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
      fill: '#1d4ed8',
      stroke: '#12328f',
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
            fill: PART.metal,
            stroke: PART.metalDark,
            strokeWidth: u(0.15),
            detail: 'normal',
          }),
          // Slot in the screw head.
          rect(cx - u(1.1), cy - u(0.2), u(2.2), u(0.4), {
            fill: '#5b6472',
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
      fill: energised ? '#2f6fbf' : '#1e5fa8',
      stroke: '#12328f',
      strokeWidth: u(0.2),
    }),
    // Moulding seam around the lid.
    rect(box.x + u(0.8), box.y + u(0.8), box.width - u(1.6), box.height - u(1.6), {
      rx: u(0.3),
      fill: 'none',
      stroke: '#12328f',
      strokeWidth: u(0.12),
      opacity: 0.7,
      detail: 'normal',
    }),
    text(
      box.x + box.width / 2,
      box.y + box.height / 2 + u(0.5),
      'SRD-05VDC',
      {
        size: u(1.1),
        fill: SILK.white,
        anchor: 'middle',
        weight: 600,
        mono: true,
        rotate: vertical ? -90 : 0,
        detail: 'normal',
      },
    ),
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
  const headerX = compact ? u(2.6) : u(4);
  const headerY = compact
    ? height / 2 - (HEADER_PITCH * (headerCount - 1)) / 2
    : height - u(2.6);

  function headerPoint(index: number): { x: number; y: number } {
    return compact
      ? { x: headerX, y: headerY + index * HEADER_PITCH }
      : { x: headerX + index * HEADER_PITCH, y: headerY };
  }

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
        description: `Channel ${channel} trigger. Active low on a standard opto-isolated module.`,
      });
    }),
  ];

  function draw(context: DeviceDrawContext): readonly Shape[] {
    const energised = relayChannels.map((channel) =>
      booleanState(context, `ch${channel}`, false),
    );

    const terminals = relayChannels.flatMap((_, index) => {
      const box = relayChannelBox(channels, index);
      return compact
        ? screwTerminal(u(45), u(3), u(8), u(20), 3, true)
        : screwTerminal(box.x - u(0.5), u(0.5), CAN_SHORT + u(1), u(11), 3, false);
    });

    const cans = relayChannels.flatMap((_, index) =>
      relayCan(relayChannelBox(channels, index), energised[index], !compact),
    );

    // Opto-isolator and status LED for each channel, between the trigger pin
    // and the coil it drives — the order the signal actually travels in.
    const control = relayChannels.flatMap((channel, index) => {
      const cx = compact ? u(13) : channelCentreX(channels, index);
      const optoY = compact ? u(8) : height - u(13);
      const ledY = compact ? u(19) : height - u(6.5);
      return [
        ...chip(cx - u(2.5), optoY, u(5), u(4), String(channel), { labelSize: u(1) }),
        ...indicatorLed(cx, ledY, 'red', energised[index], u(0.8)),
      ];
    });

    return [
      rect(0, 0, width, height, {
        rx: u(0.8),
        fill: PCB.blue,
        stroke: PCB.blueDark,
        strokeWidth: u(0.2),
      }),
      mountingHole(u(2.5), u(2.5)),
      mountingHole(width - u(2.5), height - u(2.5)),
      ...(compact
        ? []
        : [mountingHole(width - u(2.5), u(2.5)), mountingHole(u(2.5), height - u(2.5))]),

      ...terminals,
      ...cans,
      ...control,

      // NO / COM / NC silkscreen under each terminal block.
      ...(compact
        ? [
            silkLabel(u(43.6), u(7), 'NO', { size: u(1.1), anchor: 'end', detail: 'normal' }),
            silkLabel(u(43.6), u(13.6), 'COM', { size: u(1.1), anchor: 'end', detail: 'normal' }),
            silkLabel(u(43.6), u(20.2), 'NC', { size: u(1.1), anchor: 'end', detail: 'normal' }),
          ]
        : relayChannels.flatMap((_, index) => {
            const box = relayChannelBox(channels, index);
            return ['NO', 'CO', 'NC'].map((label, pole) =>
              text(box.x + (CAN_SHORT / 3) * (pole + 0.5), u(12.4), label, {
                size: u(0.95),
                fill: SILK.soft,
                anchor: 'middle',
                mono: true,
                detail: 'high',
              }),
            );
          })),

      // Control header and its printed names.
      ...maleHeader(headerX, headerY, headerCount, compact ? 'vertical' : 'horizontal'),
      ...pins.map((headerPin, index) => {
        const point = headerPoint(index);
        return text(
          compact ? point.x + u(2) : point.x,
          compact ? point.y + u(0.4) : point.y - u(2.2),
          headerPin.name,
          {
            size: u(1),
            fill: SILK.white,
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
        { size: u(1.1), fill: SILK.soft, detail: 'high' },
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
    properties: relayChannels.map((channel) => ({
      id: `ch${channel}`,
      label: channels === 1 ? 'ต่อวงจร' : `ช่อง ${channel}`,
      kind: 'boolean' as const,
      defaultValue: false,
      group: 'simulation' as const,
      description: `Energises the channel ${channel} coil, switching COM from NC to NO.`,
    })),
    pins,
    render: { draw },
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

export const RELAY_1CH = createRelayDevice('relay', 1, 54, 430, true);
export const RELAY_2CH = createRelayDevice('relay2', 2, 84, 410, false);
export const RELAY_4CH = createRelayDevice('relay4', 4, 144, 370, false);
export const RELAY_8CH = createRelayDevice('relay8', 8, 174, 270, false);
