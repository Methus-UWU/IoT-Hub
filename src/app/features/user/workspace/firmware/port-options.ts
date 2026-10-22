import type { CustomSelectOption } from '../../../../shared/components/custom-select/custom-select';
import {
  portMismatchesBoard,
  type SerialPortChoice,
  type SerialUnavailableReason,
} from './web-serial';

export const ADD_PORT_VALUE = '__add_port__';
export const REFRESH_PORTS_VALUE = '__refresh_ports__';

export interface PortOptionsInput {
  readonly unavailableReason: SerialUnavailableReason | null;
  readonly ports: readonly SerialPortChoice[];
  readonly selectedPortId: string;
  readonly selectedPortMissing: boolean;
  readonly selectedPortLabel: string;
  /** The project's board name, to flag a port that is plainly a different family. */
  readonly board: string;
}

/**
 * The device menu: granted ports, the unplugged board the user chose, and the actions.
 *
 * Kept apart from the IDE page so the rules — what is shown when the browser cannot use
 * Web Serial, how an unplugged board stays selected — are checked without a browser.
 */
export function buildPortOptions(input: PortOptionsInput): CustomSelectOption[] {
  if (input.unavailableReason === 'insecure') {
    return [
      {
        value: '',
        label: 'ต้องเปิดผ่าน HTTPS',
        description: 'เบราว์เซอร์อนุญาต Web Serial เฉพาะหน้าเว็บที่ปลอดภัย',
        disabled: true,
      },
    ];
  }
  if (input.unavailableReason === 'unsupported') {
    return [
      {
        value: '',
        label: 'เบราว์เซอร์นี้ไม่รองรับ Web Serial',
        description: 'ใช้ Chrome หรือ Edge บนคอมพิวเตอร์เพื่ออัปโหลดลงบอร์ด',
        disabled: true,
      },
    ];
  }

  const actions: CustomSelectOption[] = [
    {
      value: REFRESH_PORTS_VALUE,
      label: 'ค้นหาอุปกรณ์อีกครั้ง',
      description: 'อ่านรายการพอร์ตที่อนุญาตแล้วใหม่ โดยไม่ต้องรีเฟรชหน้า',
    },
    {
      value: ADD_PORT_VALUE,
      label: 'เพิ่มอุปกรณ์…',
      description: 'เลือกพอร์ต เช่น COM3 หรือ /dev/ttyUSB0 จากหน้าต่างของเบราว์เซอร์',
    },
  ];

  const missing: CustomSelectOption[] = input.selectedPortMissing
    ? [
        {
          value: input.selectedPortId,
          label: `ถอดออกแล้ว · ${input.selectedPortLabel || 'อุปกรณ์ที่เลือก'}`,
          description: 'เสียบสาย USB อีกครั้ง ระบบจะเชื่อมต่อให้เอง',
          disabled: true,
        },
      ]
    : [];

  if (input.ports.length === 0) {
    return [
      ...missing,
      ...(missing.length
        ? []
        : [
            {
              value: '',
              label: 'ยังไม่พบอุปกรณ์',
              description: 'เสียบบอร์ดผ่าน USB แล้วกดเพิ่มอุปกรณ์',
              disabled: true,
            },
          ]),
      ...actions,
    ];
  }

  return [
    ...missing,
    ...input.ports.map((port) => ({
      value: port.id,
      label: port.label,
      description: portMismatchesBoard(port, input.board)
        ? `อาจไม่ใช่บอร์ด ${input.board} ตรวจสอบก่อนอัปโหลด`
        : 'พอร์ตที่อนุญาตแล้ว',
    })),
    ...actions,
  ];
}
