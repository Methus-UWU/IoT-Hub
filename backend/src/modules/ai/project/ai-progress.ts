import { AiToolCall } from '../providers/ai-provider.interface';
import type { ToolOutcome } from './ai-tool-executor';

/**
 * What the assistant is doing right now, for a client showing a turn in progress.
 *
 * A turn is a dozen or more model rounds and can take minutes on a free model. A
 * spinner for that long reads as a hang; naming each step — reading the DHT22
 * datasheet, wiring the relay, writing main.ino — shows the turn moving and what
 * it is building. Events describe intent only: nothing here is applied, and the
 * same turn still ends in a plan or an error.
 */
export type AiProgressStage =
  | 'thinking'
  | 'searching'
  | 'reading_datasheet'
  | 'adding_device'
  | 'configuring'
  | 'wiring'
  | 'reading_code'
  | 'writing_code'
  | 'checking';

export interface AiProgressEvent {
  readonly stage: AiProgressStage;
  /** A short subject, e.g. a part label or a file path. Never tool output. */
  readonly detail?: string;
  readonly status?: 'pending' | 'completed' | 'reused' | 'failed' | 'warning';
}

export type AiProgressListener = (event: AiProgressEvent) => void;

/** Only structured outcomes cross into progress; never source or raw tool output. */
export function progressResult(
  event: AiProgressEvent,
  outcome: ToolOutcome,
): AiProgressEvent {
  return {
    ...event,
    status: !outcome.ok
      ? 'failed'
      : outcome.device?.wiringIncomplete
        ? 'warning'
        : outcome.device && !outcome.device.created
          ? 'reused'
          : 'completed',
  };
}

/** The step a tool call represents, described from its arguments. */
export function progressOf(
  call: AiToolCall,
  labelOf: (componentId: string) => string,
): AiProgressEvent {
  const args = parse(call.rawArguments);
  const text = (key: string) => {
    const value = args[key];
    return typeof value === 'string' ? value.slice(0, 80) : '';
  };
  const component = (key: string) => {
    const id = text(key);
    return id ? labelOf(id) : '';
  };

  switch (call.name) {
    case 'search_device_catalog':
      return { stage: 'searching', detail: text('query') };
    case 'read_device_datasheet':
      return { stage: 'reading_datasheet', detail: text('definitionId') };
    case 'add_device':
      return {
        stage: 'adding_device',
        detail: text('label') || text('definitionId'),
      };
    case 'configure_device':
      return { stage: 'configuring', detail: component('componentId') };
    case 'wire_to_board':
      return {
        stage: 'wiring',
        detail: `${component('componentId')} ${text('devicePin')}`.trim(),
      };
    case 'connect_pins':
    case 'disconnect_pins':
      return {
        stage: 'wiring',
        detail: `${component('fromComponentId')} ${text('fromPin')} → ${component(
          'toComponentId',
        )} ${text('toPin')}`,
      };
    case 'read_source_file':
      return { stage: 'reading_code', detail: text('path') };
    case 'write_source_file':
      return { stage: 'writing_code', detail: text('path') };
    default:
      return { stage: 'checking' };
  }
}

function parse(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
