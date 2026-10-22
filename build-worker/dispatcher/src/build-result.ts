import type { ContainerOutcome } from './builder-container.ts';
import type { BuildResult, FailureReason } from './protocol.ts';

/**
 * Turns what the container did into the result the API records.
 *
 * The builder writes one JSON line to stdout as its last act, but user code ran
 * in the same container and could have written there too, so only the last line
 * is read and only the fields the API accepts are passed on. The API checks the
 * image set again; this is the first filter, not the only one.
 */

const REPORTED_REASONS: readonly FailureReason[] = [
  'compile',
  'rejected',
  'artifacts',
];

function lastLine(stdout: string): unknown {
  const lines = stdout.trimEnd().split('\n');
  try {
    return JSON.parse(lines[lines.length - 1] ?? '');
  } catch {
    return null;
  }
}

function failed(
  outcome: ContainerOutcome,
  reason: FailureReason,
  note?: string,
): BuildResult {
  return {
    status: 'failed',
    failureReason: reason,
    log: note ? `${outcome.log}\n${note}\n` : outcome.log,
    durationMs: outcome.durationMs,
  };
}

function isArtifact(value: unknown): value is { name: string; data: string } {
  if (typeof value !== 'object' || value === null) return false;
  const artifact = value as Record<string, unknown>;
  return typeof artifact.name === 'string' && typeof artifact.data === 'string';
}

export function toBuildResult(outcome: ContainerOutcome): BuildResult {
  if (outcome.timedOut) {
    return failed(outcome, 'timeout', 'Build stopped: it ran longer than allowed.');
  }
  if (outcome.stdoutOverflow) {
    return failed(
      outcome,
      'worker_error',
      'Build stopped: it produced too much output.',
    );
  }

  const report = lastLine(outcome.stdout);
  if (typeof report !== 'object' || report === null) {
    // Killed by the OOM killer, or the builder never got as far as reporting.
    return failed(
      outcome,
      'worker_error',
      outcome.exitCode === 137
        ? 'Build stopped: it ran out of memory.'
        : 'Build stopped before it reported a result.',
    );
  }

  const result = report as Record<string, unknown>;
  if (
    result.ok === true &&
    outcome.exitCode === 0 &&
    Array.isArray(result.artifacts)
  ) {
    return {
      status: 'succeeded',
      log: outcome.log,
      durationMs: outcome.durationMs,
      artifacts: result.artifacts
        .filter(isArtifact)
        .map(({ name, data }) => ({ name, data })),
    };
  }

  const reason =
    REPORTED_REASONS.find((known) => known === result.reason) ?? 'worker_error';
  return failed(outcome, reason);
}
