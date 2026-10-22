import type { DeviceKind } from '../../device-library.models';
import {
  type DevicePin,
  type LcdInterface,
  type VirtualDevice,
} from '../../models/virtual-device.model';
import {
  booleanState,
  stringState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import type { DeviceBehavior, DeviceSimulationContext } from '../core/device-simulation';
import { i2cTextDisplay } from '../core/bus-peripherals';
import { OUTLINE, PART, PCB, SCREEN, SILK } from '../core/device-palette';
import { maleHeader, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, path, rect, repeat, text, type Shape } from '../core/device-shape';

/**
 * HD44780 character LCD modules, in the four shapes the catalog carries.
 *
 * The PCB sizes follow the physical modules: 80 × 36 mm for a 1602 and
 * 98 × 60 mm for a 2004. The 2004 viewing area is sized from the 1602 character
 * pitch so four rows stay just as legible instead of being compressed vertically.
 *
 * Displayed text is a device property, not a hard-coded demo string. A screen
 * that shows invented sensor readings before the user has wired anything is a
 * screen that lies about the circuit.
 */

type LcdDeviceKind = 'lcd' | 'lcd1602parallel' | 'lcd2004parallel' | 'lcd2004i2c';

/** The HD44780 parallel pinout, in silkscreen order. */
const PARALLEL_PINS: readonly (readonly [name: string, detail: string])[] = [
  ['VSS', 'Ground reference'],
  ['VDD', 'Logic supply, 5 V'],
  ['VO', 'Contrast bias, usually a trimmer to ground'],
  ['RS', 'Register select: low for command, high for data'],
  ['RW', 'Read/write select. Tie low to write only'],
  ['E', 'Enable strobe, latches on the falling edge'],
  ['D0', 'Data bit 0, unused in 4-bit mode'],
  ['D1', 'Data bit 1, unused in 4-bit mode'],
  ['D2', 'Data bit 2, unused in 4-bit mode'],
  ['D3', 'Data bit 3, unused in 4-bit mode'],
  ['D4', 'Data bit 4'],
  ['D5', 'Data bit 5'],
  ['D6', 'Data bit 6'],
  ['D7', 'Data bit 7, also the busy flag'],
  ['A', 'Backlight anode'],
  ['K', 'Backlight cathode'],
];

const I2C_PINS: readonly (readonly [name: string, detail: string])[] = [
  ['GND', 'Ground reference'],
  ['VCC', 'Supply, 5 V'],
  ['SDA', 'I2C data'],
  ['SCL', 'I2C clock'],
];

interface PanelGeometry {
  /** Module PCB. */
  readonly boardMm: { widthMm: number; heightMm: number };
  /** Metal bezel around the glass. */
  readonly bezelMm: { widthMm: number; heightMm: number };
  /** Lit viewing window inside the bezel. */
  readonly viewMm: { widthMm: number; heightMm: number };
}

const PANELS: Readonly<Record<'1602' | '2004', PanelGeometry>> = {
  '1602': {
    boardMm: { widthMm: 80, heightMm: 36 },
    bezelMm: { widthMm: 71.3, heightMm: 24.3 },
    viewMm: { widthMm: 64.5, heightMm: 16.4 },
  },
  '2004': {
    boardMm: { widthMm: 98, heightMm: 60 },
    // Keep the same character-cell pitch as the 16x2. Four rows therefore use
    // exactly twice its active height instead of shrinking every LCD pixel.
    bezelMm: { widthMm: 87.425, heightMm: 40.7 },
    viewMm: { widthMm: 80.625, heightMm: 32.8 },
  },
};

/** First header pin, clear of the top-left mounting hole. */
const HEADER_X = u(6.5);
const HEADER_Y = u(2.6);
/**
 * I2C header hugs the left edge without inventing a visible backpack board. Like
 * every other module, the pins leave the housing as bare leads and a wire lands
 * on the lead tip, clear of the artwork.
 */
const I2C_HEADER_X = -u(1.25);
const I2C_PIN_X = -u(6);
const I2C_LABEL_X = u(1.2);
const MOUNTING_HOLE_XY = u(2.5);
const MOUNTING_HOLE_RADIUS = u(1.15);

/** One compound PCB path whose four inner circles are genuinely transparent. */
function lcdPcbPath(width: number, height: number): string {
  const corner = u(0.6);
  const holes = [
    [MOUNTING_HOLE_XY, MOUNTING_HOLE_XY],
    [width - MOUNTING_HOLE_XY, MOUNTING_HOLE_XY],
    [MOUNTING_HOLE_XY, height - MOUNTING_HOLE_XY],
    [width - MOUNTING_HOLE_XY, height - MOUNTING_HOLE_XY],
  ] as const;

  return [
    `M ${corner} 0 H ${width - corner} A ${corner} ${corner} 0 0 1 ${width} ${corner}`,
    `V ${height - corner} A ${corner} ${corner} 0 0 1 ${width - corner} ${height}`,
    `H ${corner} A ${corner} ${corner} 0 0 1 0 ${height - corner}`,
    `V ${corner} A ${corner} ${corner} 0 0 1 ${corner} 0 Z`,
    ...holes.map(
      ([cx, cy]) =>
        `M ${cx - MOUNTING_HOLE_RADIUS} ${cy}` +
        ` A ${MOUNTING_HOLE_RADIUS} ${MOUNTING_HOLE_RADIUS} 0 1 0 ${cx + MOUNTING_HOLE_RADIUS} ${cy}` +
        ` A ${MOUNTING_HOLE_RADIUS} ${MOUNTING_HOLE_RADIUS} 0 1 0 ${cx - MOUNTING_HOLE_RADIUS} ${cy} Z`,
    ),
  ].join(' ');
}

/** Metal plating surrounds the cut-out but never paints over its centre. */
function lcdMountingRings(width: number, height: number): readonly Shape[] {
  return [
    [MOUNTING_HOLE_XY, MOUNTING_HOLE_XY],
    [width - MOUNTING_HOLE_XY, MOUNTING_HOLE_XY],
    [MOUNTING_HOLE_XY, height - MOUNTING_HOLE_XY],
    [width - MOUNTING_HOLE_XY, height - MOUNTING_HOLE_XY],
  ].map(([cx, cy]) =>
    circle(cx, cy, u(1.55), {
      fill: 'none',
      stroke: PART.solder,
      strokeWidth: u(0.5),
    }),
  );
}

interface LcdOptions {
  id: LcdDeviceKind;
  columns: 16 | 20;
  rows: 2 | 4;
  interface: LcdInterface;
  x: number;
  y: number;
  initiallyVisible?: boolean;
  description?: string;
}

function textProperties(rows: number): readonly DevicePropertyDefinition[] {
  return [
    {
      id: 'backlight',
      label: 'ไฟพื้นหลัง',
      kind: 'boolean',
      defaultValue: true,
      group: 'general',
      description: 'Backlight LED. Off leaves the characters barely legible, as on real glass.',
    },
    ...Array.from({ length: rows }, (_, index) => ({
      id: `line${index + 1}`,
      label: `บรรทัด ${index + 1}`,
      kind: 'text' as const,
      defaultValue: '',
      group: 'general' as const,
      description: 'Text this row displays. Leave blank for a blank row.',
    })),
  ];
}

/**
 * The PCF8574 backpack's address, set by its A0–A2 jumpers. Two displays on one bus
 * need different ones; 0x27 is the PCF8574T default and 0x3F the PCF8574AT's.
 */
const I2C_ADDRESS_PROPERTY: DevicePropertyDefinition = {
  id: 'address',
  label: 'I2C address',
  kind: 'select',
  defaultValue: '0x27',
  group: 'advanced',
  description: 'Set by the A0–A2 jumpers on the backpack. Each display on one bus needs its own.',
  options: [
    { value: '0x27', label: '0x27' },
    { value: '0x3F', label: '0x3F' },
    { value: '0x26', label: '0x26' },
    { value: '0x25', label: '0x25' },
    { value: '0x20', label: '0x20' },
  ],
};

function createLcdDevice(options: LcdOptions): VirtualDevice {
  const { columns, rows, interface: lcdInterface } = options;
  const isI2c = lcdInterface === 'i2c';
  const panel = PANELS[columns === 16 ? '1602' : '2004'];
  const BODY = bodyFromMm(panel.boardMm);
  const width = BODY.width;
  const height = BODY.height;

  const bezelWidth = u(panel.bezelMm.widthMm);
  const bezelHeight = u(panel.bezelMm.heightMm);
  const bezelX = (width - bezelWidth) / 2;
  // Below the header, then centred in what is left. That is where the glass
  // lands on a real module, and it is why the bottom border is the wider one.
  const bezelY = u(5) + (height - u(5) - bezelHeight) / 2;

  const viewWidth = u(panel.viewMm.widthMm);
  const viewHeight = u(panel.viewMm.heightMm);
  const viewX = bezelX + (bezelWidth - viewWidth) / 2;
  const viewY = bezelY + (bezelHeight - viewHeight) / 2;

  const cellWidth = viewWidth / columns;
  const cellHeight = viewHeight / rows;

  const pins: readonly DevicePin[] = isI2c
    ? I2C_PINS.map(([name, detail], index) =>
        pin(
          name,
          I2C_PIN_X,
          height / 2 - (HEADER_PITCH * (I2C_PINS.length - 1)) / 2 + index * HEADER_PITCH,
          name === 'GND' ? 'gnd' : name === 'VCC' ? 'vcc' : name === 'SDA' ? 'i2c-sda' : 'i2c-scl',
          { side: 'left', description: detail, voltage: name === 'VCC' ? 5 : undefined },
        ),
      )
    : PARALLEL_PINS.map(([name, detail], index) =>
        pin(
          name,
          HEADER_X + index * HEADER_PITCH,
          HEADER_Y,
          name === 'VSS' || name === 'K'
            ? 'gnd'
            : name === 'VDD' || name === 'A'
              ? 'vcc'
              : name === 'VO'
                ? 'analog'
                : 'digital',
          { side: 'top', description: detail, voltage: name === 'VDD' ? 5 : undefined },
        ),
      );

  /** Supply pins, named differently on the backpack and the bare module. */
  const supplyPin = isI2c ? 'VCC' : 'VDD';
  const groundPin = isI2c ? 'GND' : 'VSS';

  /**
   * The panel only shows anything once its own supply is complete.
   *
   * `powered` is a runtime value, not a property: it is written by the solve
   * each tick and vanishes when the simulation stops, which is exactly when the
   * glass should go dark. A module wired for data but not for power therefore
   * reads as dead on the canvas rather than displaying text it could never
   * drive.
   */
  function createBehavior(): DeviceBehavior {
    const powered = (context: DeviceSimulationContext) => {
      const supply = context.readNode(supplyPin);
      const ground = context.readNode(groundPin);
      return !supply.floating && !ground.floating && supply.voltage - ground.voltage >= 4.7;
    };
    // The I2C backpack also answers LiquidCrystal_I2C; the parallel module is
    // driven pin by pin, which the simulator does not emulate.
    const bus = isI2c
      ? i2cTextDisplay({
          sdaPin: 'SDA',
          chip: 'pcf8574',
          protocol: 'lcd',
          rows,
          address: { property: 'address', fallback: '0x27' },
        })()
      : null;

    return {
      drive(context: DeviceSimulationContext) {
        if (bus && powered(context)) bus.drive?.(context);
      },
      update(context: DeviceSimulationContext) {
        const on = powered(context);
        context.emit('powered', on);
        if (!bus) return;
        if (on) bus.update?.(context);
        else bus.reset?.();
      },
      reset() {
        bus?.reset?.();
      },
    };
  }

  function draw(context: DeviceDrawContext): readonly Shape[] {
    // Defaults to false, so a stopped workspace draws the same dark glass an
    // unpowered module does.
    const powered = booleanState(context, 'powered', false);
    const lit = powered && booleanState(context, 'backlight', true);
    const glass = lit ? SCREEN.lcdGreenLit : SCREEN.lcdGreen;
    // Unlit glass still shows its characters, just with far less contrast —
    // exactly what a real module does when you forget the backlight.
    const inkOpacity = lit ? 1 : 0.35;

    const lines = powered
      ? Array.from({ length: rows }, (_, index) =>
          stringState(context, `line${index + 1}`, '')
            .slice(0, columns)
            .toUpperCase(),
        )
      : // No supply, no controller, no characters — the cell grid stays, because
        // that is what an unpowered panel actually looks like.
        Array.from({ length: rows }, () => '');

    return [
      // Module PCB.
      path(lcdPcbPath(width, height), {
        fill: PCB.green,
        stroke: PCB.greenDark,
        strokeWidth: u(0.2),
        fillRule: 'evenodd',
      }),
      ...lcdMountingRings(width, height),

      // Metal bezel, then the glass it frames.
      rect(bezelX, bezelY, bezelWidth, bezelHeight, {
        rx: u(0.4),
        fill: PART.metal,
        stroke: PART.metalDark,
        strokeWidth: u(0.2),
      }),
      rect(bezelX + u(0.6), bezelY + u(0.6), bezelWidth - u(1.2), bezelHeight - u(1.2), {
        rx: u(0.2),
        fill: SCREEN.glassEdge,
        detail: 'normal',
      }),
      rect(viewX, viewY, viewWidth, viewHeight, { fill: glass }),

      // Character cells. Drawn as the faint unlit blocks a real panel shows
      // between glyphs, which is what makes the grid read as a dot-matrix
      // display rather than a green rectangle.
      ...repeat(
        rows,
        { y: cellHeight },
        (_, __, rowY) =>
          repeat(
            columns,
            { x: cellWidth },
            (___, cellX) =>
              rect(
                cellX + cellWidth * 0.17,
                rowY + cellHeight * 0.14,
                cellWidth * 0.66,
                cellHeight * 0.72,
                { fill: SCREEN.lcdText, opacity: 0.09, detail: 'normal' },
              ),
            { x: viewX },
          ),
        { y: viewY },
      ),

      // Displayed text, aligned to the same cell pitch as the blocks below it.
      ...lines.map((content, row) =>
        text(viewX + cellWidth * 0.22, viewY + row * cellHeight + cellHeight * 0.74, content, {
          size: Math.min(cellHeight * 0.66, cellWidth * 1.42),
          fill: SCREEN.lcdText,
          anchor: 'start',
          weight: 600,
          mono: true,
          letterSpacing: cellWidth * 0.2,
          opacity: inkOpacity,
        }),
      ),

      ...(isI2c
        ? [
            // Four-pin I2C header on the left PCB edge: a moulded housing with a
            // gold pad per way, and a tinned lead standing out to the pin tip.
            rect(
              I2C_HEADER_X - u(1.25),
              height / 2 - (HEADER_PITCH * I2C_PINS.length) / 2,
              u(2.5),
              HEADER_PITCH * I2C_PINS.length,
              {
                rx: u(0.2),
                fill: PART.headerPlastic,
                stroke: '#0b0d10',
                strokeWidth: u(0.1),
              },
            ),
            ...I2C_PINS.flatMap((_, index) => {
              const y =
                height / 2 - (HEADER_PITCH * (I2C_PINS.length - 1)) / 2 + index * HEADER_PITCH;
              return [
                rect(I2C_PIN_X, y - u(0.28), I2C_HEADER_X - I2C_PIN_X, u(0.56), {
                  rx: u(0.18),
                  fill: PART.metal,
                  stroke: PART.metalDark,
                  strokeWidth: u(0.06),
                }),
                rect(I2C_HEADER_X - u(0.45), y - u(0.45), u(0.9), u(0.9), {
                  rx: u(0.08),
                  fill: PART.headerGold,
                  stroke: PART.headerGoldDark,
                  strokeWidth: u(0.08),
                }),
              ];
            }),
            ...I2C_PINS.map(([name], index) =>
              text(
                I2C_LABEL_X,
                height / 2 -
                  (HEADER_PITCH * (I2C_PINS.length - 1)) / 2 +
                  index * HEADER_PITCH +
                  u(0.4),
                name,
                {
                  size: u(1),
                  fill: SILK.white,
                  anchor: 'start',
                  mono: true,
                  weight: 600,
                  detail: 'normal',
                },
              ),
            ),
          ]
        : [
            // 16-pin data header along the top edge.
            rect(
              HEADER_X - HEADER_PITCH / 2 - u(0.25),
              HEADER_Y - u(1.65),
              HEADER_PITCH * PARALLEL_PINS.length + u(0.5),
              u(3.3),
              {
                rx: u(0.28),
                fill: PART.headerPlastic,
                stroke: OUTLINE,
                strokeWidth: u(0.12),
              },
            ),
            ...maleHeader(HEADER_X, HEADER_Y, PARALLEL_PINS.length, 'horizontal'),
            ...PARALLEL_PINS.map(([name], index) =>
              text(HEADER_X + index * HEADER_PITCH, HEADER_Y + u(3), name, {
                size: u(1),
                fill: SILK.white,
                anchor: 'start',
                mono: true,
                weight: 600,
                rotate: 90,
                detail: 'normal',
              }),
            ),
          ]),

      // Ends left of the bottom-right mounting ring rather than running into it.
      silkLabel(width - u(5), height - u(2), `${columns}x${rows}`, {
        size: u(1.6),
        anchor: 'end',
        fill: SILK.soft,
        detail: 'normal',
      }),
    ];
  }

  return {
    id: options.id as DeviceKind,
    name: `LCD ${columns}x${rows}${isI2c ? ' I2C' : ''}`,
    model: `${columns === 16 ? 'LCD1602' : 'LCD2004'}${isI2c ? ' + PCF8574' : ' / HD44780'}`,
    description:
      options.description ??
      `${columns}x${rows} HD44780-compatible character display using ${
        isI2c ? 'an I2C backpack' : 'the parallel data bus'
      }.`,
    x: options.x,
    y: options.y,
    ...BODY,
    initiallyVisible: options.initiallyVisible ?? false,
    operatingVoltage: { min: 4.7, max: 5.3, recommended: 5 },
    interfaces: isI2c ? ['i2c', 'power'] : ['digital', 'power'],
    printsOwnPinLabels: true,
    lcdConfig: {
      columns,
      rows,
      interface: lcdInterface,
      columnIndexes: Array.from({ length: columns }, (_, index) => index),
      rowIndexes: Array.from({ length: rows }, (_, index) => index),
    },
    properties: isI2c ? [...textProperties(rows), I2C_ADDRESS_PROPERTY] : textProperties(rows),
    ...(isI2c
      ? { i2cAddress: { property: 'address', fallback: '0x27' } }
      : {}),
    pins,
    render: { draw, ...(isI2c ? { bleed: { left: u(6.5) } } : {}) },
    simulation: createBehavior,
    catalog: {
      categoryId: 'displays',
      category: 'Displays',
      aliases: isI2c
        ? [`${columns}0${rows} display`, `${columns} by ${rows} LCD`, 'I2C screen']
        : [`${columns}0${rows} display`, `${columns} by ${rows} LCD`, 'parallel LCD'],
      tags: [
        'lcd',
        'screen',
        'display',
        'character',
        'HD44780',
        ...(isI2c ? ['I2C', 'PCF8574', 'data'] : ['parallel', 'digital']),
      ],
      interfaceLabel: isI2c ? 'I2C · 4 ขา' : 'พาราเลล 8 บิต · 16 ขา',
      typicalUsage: isI2c
        ? 'Status screens and live readouts with minimal controller pin usage.'
        : 'Character interfaces where direct GPIO control is preferred.',
    },
  };
}

export const LCD_1602_I2C = createLcdDevice({
  id: 'lcd',
  columns: 16,
  rows: 2,
  interface: 'i2c',
  x: 46,
  y: 58,
  initiallyVisible: true,
  description: 'Displays live sensor values over the I2C bus.',
});

export const LCD_1602_PARALLEL = createLcdDevice({
  id: 'lcd1602parallel',
  columns: 16,
  rows: 2,
  interface: 'parallel',
  x: 36,
  y: 52,
});

export const LCD_2004_PARALLEL = createLcdDevice({
  id: 'lcd2004parallel',
  columns: 20,
  rows: 4,
  interface: 'parallel',
  x: 26,
  y: 44,
});

export const LCD_2004_I2C = createLcdDevice({
  id: 'lcd2004i2c',
  columns: 20,
  rows: 4,
  interface: 'i2c',
  x: 56,
  y: 54,
});
