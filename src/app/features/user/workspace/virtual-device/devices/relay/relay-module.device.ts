import type { DeviceKind } from '../../device-library.models';
import type { VirtualDevice } from '../../models/virtual-device.model';

type RelayDeviceKind = 'relay' | 'relay2' | 'relay4' | 'relay8';
type RelayChannelCount = 1 | 2 | 4 | 8;

const CHANNEL_ALIASES: Readonly<Record<RelayChannelCount, string>> = {
  1: 'single relay',
  2: 'dual relay',
  4: 'quad relay',
  8: 'eight relay',
};

function createRelayDevice(
  id: RelayDeviceKind,
  channels: RelayChannelCount,
  x: number,
  y: number,
  initiallyVisible: boolean,
): VirtualDevice {
  const relayChannels = Array.from({ length: channels }, (_, index) => index + 1);
  const width = channels === 1 ? 290 : channels === 8 ? 270 : 180 + channels * 70;
  const height = channels === 1 ? 155 : channels === 8 ? 520 : 205;

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
    relayChannels,
    initiallyVisible,
    pins: [
      { name: 'VCC', x: 0, y: channels === 1 ? 52 : 30, kind: 'power' },
      { name: 'GND', x: 0, y: channels === 1 ? 72 : 50, kind: 'ground' },
      ...relayChannels.map((channel, index) => ({
        name: channels === 1 ? 'IN' : `IN${channel}`,
        x: 0,
        y: channels === 1 ? 92 : channels === 8 ? 82 + index * 52 : 80 + index * 20,
        kind: 'signal' as const,
      })),
    ],
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
 * Bounds of one relay block in device coordinates. Shared by the artwork and by
 * the canvas hit target so the clickable area always matches what is drawn.
 */
export function relayChannelBox(
  channels: number,
  index: number,
): { x: number; y: number; width: number; height: number } {
  if (channels === 1) return { x: 142, y: 34, width: 100, height: 70 };
  if (channels === 8) return { x: 118, y: 60 + index * 52, width: 74, height: 44 };
  return { x: 157 + index * 70, y: 54, width: 52, height: 70 };
}

export const RELAY_1CH = createRelayDevice('relay', 1, 54, 430, true);
export const RELAY_2CH = createRelayDevice('relay2', 2, 84, 410, false);
export const RELAY_4CH = createRelayDevice('relay4', 4, 144, 370, false);
export const RELAY_8CH = createRelayDevice('relay8', 8, 174, 270, false);
