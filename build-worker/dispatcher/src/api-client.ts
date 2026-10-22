import type { DispatcherConfig } from './config.ts';
import { type BuildResult, type ClaimedJob, isClaimedJob } from './protocol.ts';

/**
 * The worker routes of the API, authenticated with the worker token only.
 */
export class BuildApiClient {
  private readonly config: DispatcherConfig;

  constructor(config: DispatcherConfig) {
    this.config = config;
  }

  /** The oldest queued build, or null when there is nothing to do. */
  async claim(): Promise<ClaimedJob | null> {
    const response = await this.post('/internal/build-jobs/claim', {});
    if (response.status === 204) return null;
    if (!response.ok) throw await this.failure('claim', response);

    const job: unknown = await response.json();
    if (!isClaimedJob(job)) throw new Error('claim returned an unexpected job');
    return job;
  }

  /**
   * Reports a result. A 409 means the build was canceled or timed out while it
   * ran; the result is meant to be discarded, so that is not an error here.
   */
  async submit(jobId: string, result: BuildResult): Promise<'recorded' | 'discarded'> {
    const response = await this.post(
      `/internal/build-jobs/${encodeURIComponent(jobId)}/result`,
      result,
    );
    if (response.status === 409) return 'discarded';
    if (!response.ok) throw await this.failure('result', response);
    return 'recorded';
  }

  private post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.config.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.workerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  }

  /** Status and the API's error code only: never echo a body that might hold a token. */
  private async failure(action: string, response: Response): Promise<Error> {
    let code = '';
    try {
      const body = (await response.json()) as { code?: unknown };
      if (typeof body.code === 'string') code = ` ${body.code}`;
    } catch {
      // Not JSON; the status is enough.
    }
    return new Error(`${action} failed: HTTP ${response.status}${code}`);
  }
}
