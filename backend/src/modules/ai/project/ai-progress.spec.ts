import { progressResult } from './ai-progress';

describe('project generation progress', () => {
  const event = { stage: 'adding_device' as const, detail: 'RGB LED 1' };
  it('reports refusal without forwarding raw tool output', () => {
    expect(
      progressResult(event, { ok: false, content: 'private source' }),
    ).toEqual({ ...event, status: 'failed' });
  });
  it.each([
    [true, false, 'completed'],
    [false, false, 'reused'],
    [true, true, 'warning'],
  ] as const)(
    'reports created=%s and incomplete wiring=%s',
    (created, wiringIncomplete, status) => {
      expect(
        progressResult(event, {
          ok: true,
          content: 'raw output',
          device: { componentId: 'new:1', created, wiringIncomplete },
        }),
      ).toEqual({ ...event, status });
    },
  );
});
