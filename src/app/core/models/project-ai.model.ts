import { AiTaskProfile } from './ai-assistant.model';

/**
 * The project assistant's contract.
 *
 * A turn may come back with a plan: a list of changes the server validated against the
 * project's real hardware but has not written. The client never builds one and never edits
 * one — it shows the preview, and sends the same actions back untouched if the user
 * accepts. The server re-validates them either way, so the plan is a proposal in transit,
 * not an instruction.
 */

export interface AiPlanEndpoint {
  componentId: string;
  pinId: string;
}

/** A part's configured values, e.g. `{ color: 'green' }` for an LED. */
export type AiDeviceSettings = Record<string, string | number | boolean>;

export type AiPlanAction =
  | {
      type: 'add_device';
      ref: string;
      definitionId: string;
      label: string;
      settings?: AiDeviceSettings;
    }
  | { type: 'configure'; componentId: string; settings: AiDeviceSettings }
  | {
      type: 'connect';
      from: AiPlanEndpoint;
      to: AiPlanEndpoint;
      kind: 'power' | 'ground' | 'signal';
      color: string;
    }
  | { type: 'disconnect'; connectionId: string; summary: string }
  | { type: 'write_file'; path: string; content: string; created: boolean }
  | {
      /** The dashboard as the assistant would leave it; written whole on apply. */
      type: 'set_dashboard';
      document: unknown;
      datastreams: unknown[];
      baseVersion: number;
    };

export interface AiPlanPreviewLine {
  kind: 'device' | 'wiring' | 'code' | 'dashboard';
  text: string;
}

export interface AiPlan {
  actions: AiPlanAction[];
  preview: AiPlanPreviewLine[];
  /** Things the platform refused while building the plan. Advisory. */
  warnings: string[];
}

/**
 * What the IDE is currently showing about this project.
 *
 * The simulation runs in the browser, so the server cannot see a compile error, a wiring
 * finding, or the serial output on its own. Sending them is what lets the assistant answer
 * "why does this read 0" from the actual fault rather than from a guess. The server treats
 * every field as the client's report, caps its size, and states its own wiring audit
 * separately — nothing here can describe hardware the project does not have.
 */
export interface ProjectDiagnostics {
  wiring?: {
    severity: 'error' | 'warning' | 'info';
    code: string;
    title: string;
    detail: string;
  }[];
  firmware?: { phase: 'compile' | 'run'; line: number; message: string; file?: string };
  serial?: string[];
  build?: string[];
  buildState?: 'idle' | 'building' | 'success' | 'error';
}

export interface ProjectAiChatRequest {
  /**
   * The stored conversation. With it the server reads the history itself and keeps the
   * question and the answer; only the last of `messages` is read.
   */
  conversationId?: string;
  /** An AI profile, for a turn outside a conversation. */
  profileId?: string;
  model?: string;
  profile: AiTaskProfile;
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** The file open in the editor. Checked server-side against the project's own files. */
  activeFile?: string;
  diagnostics?: ProjectDiagnostics;
}

export interface ProjectAiChatResponse {
  id: string;
  model: string;
  vendor: string;
  profile: AiTaskProfile;
  autoSelected: boolean;
  content: string;
  createdAt: string;
  plan?: AiPlan;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Set when the turn was stored in a conversation. */
  conversationId?: string;
  messageId?: string;
  userMessageId?: string;
  profileId?: string | null;
}

/** What the assistant is doing, streamed while a turn runs. */
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
  stage: AiProgressStage;
  detail?: string;
  status?: 'pending' | 'completed' | 'reused' | 'failed' | 'warning';
}

export interface ApplyPlanResult {
  componentsAdded: number;
  /** The parts the plan placed; the client lays these out beside the board. */
  createdComponentIds: string[];
  connectionsAdded: number;
  connectionsRemoved: number;
  filesWritten: string[];
  /** True when the plan replaced the project's dashboard. */
  dashboardUpdated?: boolean;
}
