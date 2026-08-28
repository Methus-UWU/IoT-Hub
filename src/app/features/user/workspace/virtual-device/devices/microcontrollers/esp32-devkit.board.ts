import type { BoardPin, ConnectionKind, WireConnection } from '../../models/virtual-device.model';
import type { DeviceKind } from '../../device-library.models';

type BoardPinSpec = readonly [id: string, label: string, detail: string, kind: ConnectionKind];

// Keep the headers inset into the PCB, matching a real DevKit where the plated
// through-holes sit inside the board edge instead of hanging outside it.
const HEADER_TOP = 166;
const HEADER_STEP = 19.5;
const LEFT_HEADER_X = 426;
const RIGHT_HEADER_X = 614;

const LEFT_HEADER: readonly BoardPinSpec[] = [
  ['3v3', '3V3', 'Regulated 3.3 V supply', 'power'],
  ['en', 'EN', 'Chip enable and reset input', 'signal'],
  ['gpio36', 'VP / 36', 'ADC1 CH0, input only', 'signal'],
  ['gpio39', 'VN / 39', 'ADC1 CH3, input only', 'signal'],
  ['gpio34', 'GPIO 34', 'ADC1 CH6, input only', 'signal'],
  ['gpio35', 'GPIO 35', 'ADC1 CH7, input only', 'signal'],
  ['gpio32', 'GPIO 32', 'ADC1 CH4, Touch 9', 'signal'],
  ['gpio33', 'GPIO 33', 'ADC1 CH5, Touch 8', 'signal'],
  ['gpio25', 'GPIO 25', 'ADC2 CH8, DAC 1', 'signal'],
  ['gpio26', 'GPIO 26', 'ADC2 CH9, DAC 2', 'signal'],
  ['gpio27', 'GPIO 27', 'ADC2 CH7, Touch 7', 'signal'],
  ['gpio14', 'GPIO 14', 'ADC2 CH6, Touch 6, HSPI CLK', 'signal'],
  ['gpio12', 'GPIO 12', 'ADC2 CH5, Touch 5, HSPI MISO', 'signal'],
  ['gnd-left', 'GND', 'Ground reference', 'ground'],
  ['gpio13', 'GPIO 13', 'ADC2 CH4, Touch 4, HSPI MOSI', 'signal'],
  ['gpio9', 'SD2 / 9', 'Connected to onboard SPI flash', 'signal'],
  ['gpio10', 'SD3 / 10', 'Connected to onboard SPI flash', 'signal'],
  ['gpio11', 'CMD / 11', 'Connected to onboard SPI flash', 'signal'],
  ['vin', 'VIN / 5V', '5 V supply input or USB 5 V output', 'power'],
];

const RIGHT_HEADER: readonly BoardPinSpec[] = [
  ['gnd-right', 'GND', 'Ground reference', 'ground'],
  ['gpio23', 'GPIO 23', 'VSPI MOSI', 'signal'],
  ['gpio22', 'GPIO 22', 'I2C SCL', 'signal'],
  ['gpio1', 'TX0 / 1', 'UART0 TX', 'signal'],
  ['gpio3', 'RX0 / 3', 'UART0 RX', 'signal'],
  ['gpio21', 'GPIO 21', 'I2C SDA', 'signal'],
  ['gnd-right-b', 'GND', 'Ground reference', 'ground'],
  ['gpio19', 'GPIO 19', 'VSPI MISO', 'signal'],
  ['gpio18', 'GPIO 18', 'VSPI SCK', 'signal'],
  ['gpio5', 'GPIO 5', 'VSPI CS, boot strap', 'signal'],
  ['gpio17', 'GPIO 17', 'UART2 TX', 'signal'],
  ['gpio16', 'GPIO 16', 'UART2 RX', 'signal'],
  ['gpio4', 'GPIO 4', 'ADC2 CH0, Touch 0', 'signal'],
  ['gpio0', 'GPIO 0', 'ADC2 CH1, Touch 1, boot strap', 'signal'],
  ['gpio2', 'GPIO 2', 'ADC2 CH2, Touch 2, boot strap', 'signal'],
  ['gpio15', 'GPIO 15', 'ADC2 CH3, Touch 3, HSPI CS', 'signal'],
  ['gpio8', 'SD1 / 8', 'Connected to onboard SPI flash', 'signal'],
  ['gpio7', 'SD0 / 7', 'Connected to onboard SPI flash', 'signal'],
  ['gpio6', 'CLK / 6', 'Connected to onboard SPI flash', 'signal'],
];

function toBoardPins(
  specs: readonly BoardPinSpec[],
  x: number,
  side: 'left' | 'right',
): readonly BoardPin[] {
  return specs.map(([id, label, detail, kind], index) => ({
    id,
    label,
    detail,
    kind,
    side,
    x,
    y: HEADER_TOP + index * HEADER_STEP,
  }));
}

/** ESP32 DevKit V1 header pins, in silkscreen order. */
export const BOARD_PINS: readonly BoardPin[] = [
  ...toBoardPins(LEFT_HEADER, LEFT_HEADER_X, 'left'),
  ...toBoardPins(RIGHT_HEADER, RIGHT_HEADER_X, 'right'),
];

const WIRE_RED = '#ef4444';
const WIRE_BLACK = '#111827';
const WIRE_YELLOW = '#f59e0b';
const WIRE_BLUE = '#2563eb';
const WIRE_GREEN = '#22c55e';
const WIRE_PURPLE = '#a855f7';
const WIRE_CYAN = '#06b6d4';

/** The starter wiring shipped with a new virtual device workspace. */
export const INITIAL_CONNECTIONS: readonly WireConnection[] = [
  starterWire('lcd-vcc', 'lcd', 'VCC', '3v3', WIRE_RED, 'power'),
  starterWire('lcd-gnd', 'lcd', 'GND', 'gnd-right', WIRE_BLACK, 'ground'),
  starterWire('lcd-sda', 'lcd', 'SDA', 'gpio21', WIRE_BLUE, 'signal'),
  starterWire('lcd-scl', 'lcd', 'SCL', 'gpio22', WIRE_YELLOW, 'signal'),
  starterWire('led-sig', 'led', 'A', 'gpio26', WIRE_PURPLE, 'signal'),
  starterWire('led-gnd', 'led', 'K', 'gnd-left', WIRE_BLACK, 'ground'),
  starterWire('sonar-vcc', 'ultrasonic', 'VCC', 'vin', WIRE_RED, 'power'),
  starterWire('sonar-trig', 'ultrasonic', 'TRIG', 'gpio5', WIRE_GREEN, 'signal'),
  starterWire('sonar-echo', 'ultrasonic', 'ECHO', 'gpio18', WIRE_BLUE, 'signal'),
  starterWire('sonar-gnd', 'ultrasonic', 'GND', 'gnd-right', WIRE_BLACK, 'ground'),
  starterWire('relay-vcc', 'relay', 'VCC', 'vin', WIRE_RED, 'power'),
  starterWire('relay-gnd', 'relay', 'GND', 'gnd-left', WIRE_BLACK, 'ground'),
  starterWire('relay-in', 'relay', 'IN', 'gpio27', WIRE_YELLOW, 'signal'),
  starterWire('button-sig', 'button', '1', 'gpio4', WIRE_CYAN, 'signal'),
  starterWire('button-gnd', 'button', '3', 'gnd-left', WIRE_BLACK, 'ground'),
  starterWire('servo-pwm', 'servo', 'PWM', 'gpio13', WIRE_YELLOW, 'signal'),
  starterWire('servo-vcc', 'servo', 'VCC', 'vin', WIRE_RED, 'power'),
  starterWire('servo-gnd', 'servo', 'GND', 'gnd-right', WIRE_BLACK, 'ground'),
];

function starterWire(
  id: string,
  deviceId: DeviceKind,
  devicePin: string,
  boardPinId: string,
  color: string,
  kind: ConnectionKind,
): WireConnection {
  return {
    id,
    start: { type: 'device', deviceId, pinId: devicePin },
    end: { type: 'board', pinId: boardPinId },
    waypoints: [],
    color,
    kind,
  };
}

/** Wire colours offered in the inspector, following common jumper conventions. */
export const WIRE_COLORS: readonly string[] = [
  WIRE_BLACK,
  WIRE_RED,
  WIRE_YELLOW,
  WIRE_GREEN,
  WIRE_BLUE,
  WIRE_CYAN,
  WIRE_PURPLE,
  '#f472b6',
];
