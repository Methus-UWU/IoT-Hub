import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from './device-definition';
import { bodyFromMm, HEADER_PITCH, u } from './device-metrics';
import { pin } from './device-pin';
import { rect, text, type Shape } from './device-shape';
import type { PinDirection, PinType } from './device-types';

/** Shared PCB and labelled header geometry for small peripheral modules. */
export function moduleBoard(
  widthMm: number,
  heightMm: number,
  label: string,
  pins: readonly (readonly [string, PinType, PinDirection?])[],
  content: (context: DeviceDrawContext) => readonly Shape[],
): Pick<
  VirtualDevice,
  'width' | 'height' | 'physicalSize' | 'pins' | 'render' | 'printsOwnPinLabels'
> {
  const body = bodyFromMm({ widthMm, heightMm });
  const start = (body.width - (pins.length - 1) * HEADER_PITCH) / 2;
  return {
    ...body,
    printsOwnPinLabels: true,
    pins: pins.map(([name, type, direction], index) =>
      pin(name, start + index * HEADER_PITCH, u(2), type, {
        side: 'top',
        ...(direction ? { direction } : {}),
      }),
    ),
    render: {
      draw: (context) => [
        rect(0, 0, body.width, body.height, {
          fill: '#174c67',
          rx: u(1),
          stroke: '#0e283a',
          strokeWidth: u(0.3),
        }),
        ...pins.flatMap(([name], index) => [
          rect(start + index * HEADER_PITCH - u(0.5), u(1.5), u(1), u(1), { fill: '#d6b970' }),
          text(start + index * HEADER_PITCH, u(4), name, {
            size: u(0.65),
            anchor: 'middle',
            fill: '#fff',
            mono: true,
          }),
        ]),
        text(body.width / 2, body.height - u(1.5), label, {
          size: u(1.1),
          anchor: 'middle',
          fill: '#fff',
          mono: true,
        }),
        ...content(context),
      ],
    },
  };
}
