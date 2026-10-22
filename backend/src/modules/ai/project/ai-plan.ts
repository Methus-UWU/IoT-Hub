import { PlannedAction, isPlaceholderRef } from './project-draft';

/**
 * The change proposal shown to the user before anything is written.
 *
 * The plan is carried back to the apply endpoint verbatim rather than kept in server
 * memory, so a conversation costs nothing to hold and an apply is independent of the
 * session that produced it. That means the plan is *untrusted input on the way back in*:
 * it is re-validated against live state at apply time, and a component id inside it grants
 * no access — the route still resolves workspace membership and project ownership first.
 *
 * The preview is derived from the same actions rather than written by the model, so what
 * the user reads and what would be applied cannot disagree.
 */

export interface AiPlanPreviewLine {
  readonly kind: 'device' | 'wiring' | 'code' | 'dashboard';
  readonly text: string;
}

export interface AiPlan {
  readonly actions: readonly PlannedAction[];
  readonly preview: readonly AiPlanPreviewLine[];
  /** Advisory findings raised while the plan was built. Never blocking. */
  readonly warnings: readonly string[];
}

/** Renders the plan as the short "AI wants to" list. */
export function previewOf(
  actions: readonly PlannedAction[],
  labelOf: (componentId: string) => string,
): readonly AiPlanPreviewLine[] {
  const lines: AiPlanPreviewLine[] = [];

  for (const action of actions) {
    switch (action.type) {
      case 'add_device':
        lines.push({
          kind: 'device',
          text: `Add ${action.label}${settingsText(action.settings)}`,
        });
        break;
      case 'configure':
        lines.push({
          kind: 'device',
          text: `Set ${labelOf(action.componentId)}${settingsText(action.settings)}`,
        });
        break;
      case 'connect':
        lines.push({
          kind: 'wiring',
          text: `${labelOf(action.from.componentId)} ${action.from.pinId} → ${labelOf(
            action.to.componentId,
          )} ${action.to.pinId}`,
        });
        break;
      case 'disconnect':
        lines.push({ kind: 'wiring', text: `Remove wire ${action.summary}` });
        break;
      case 'write_file':
        lines.push({
          kind: 'code',
          text: action.created
            ? `Create ${action.path}`
            : `Modify ${action.path}`,
        });
        break;
      case 'set_dashboard':
        for (const stream of action.datastreams) {
          lines.push({
            kind: 'dashboard',
            text: `Datastream ${stream.key}: ${stream.name}${stream.unit ? ` (${stream.unit})` : ''}${
              stream.componentId ? ` from ${labelOf(stream.componentId)}` : ''
            }`,
          });
        }
        for (const widget of action.document.widgets) {
          lines.push({
            kind: 'dashboard',
            text: `Widget ${widget.type} "${widget.title}"${widget.datasource ? ` ← ${widget.datasource}` : ''}`,
          });
        }
        if (!action.document.widgets.length) {
          lines.push({ kind: 'dashboard', text: 'Clear the dashboard' });
        }
        break;
    }
  }

  return lines;
}

/**
 * Rejects a plan whose shape is wrong before any of it is applied.
 *
 * Two failures matter. A wire may reference a component the plan creates, and that
 * reference is only meaningful if the creating action comes first — otherwise apply would
 * have nothing to resolve it to. And a plan arriving from a client could name a
 * placeholder that no action introduces at all, which is a fabricated id by another route.
 */
export function assertPlanIsCoherent(actions: readonly PlannedAction[]): void {
  const introduced = new Set<string>();

  for (const action of actions) {
    if (action.type === 'add_device') {
      if (!isPlaceholderRef(action.ref)) {
        throw new Error('A staged device must carry a placeholder reference');
      }
      introduced.add(action.ref);
      continue;
    }

    if (action.type === 'set_dashboard') {
      const references = [
        ...action.datastreams.map((stream) => stream.componentId ?? ''),
        ...action.document.widgets.map((widget) => widget.deviceId),
      ];
      for (const reference of references) {
        if (isPlaceholderRef(reference) && !introduced.has(reference)) {
          throw new Error(
            `Dashboard references ${reference}, which no earlier action creates`,
          );
        }
      }
      continue;
    }

    if (action.type !== 'connect') continue;

    for (const endpoint of [action.from, action.to]) {
      if (
        isPlaceholderRef(endpoint.componentId) &&
        !introduced.has(endpoint.componentId)
      ) {
        throw new Error(
          `Wire references ${endpoint.componentId}, which no earlier action creates`,
        );
      }
    }
  }
}

function settingsText(
  settings: Readonly<Record<string, string | number | boolean>> | undefined,
): string {
  const entries = Object.entries(settings ?? {});
  if (!entries.length) return '';
  return ` (${entries.map(([id, value]) => `${id}: ${String(value)}`).join(', ')})`;
}
