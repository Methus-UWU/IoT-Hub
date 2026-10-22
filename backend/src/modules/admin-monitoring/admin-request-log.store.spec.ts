import { AdminRequestLogStore } from './admin-request-log.store';

describe('AdminRequestLogStore', () => {
  it('records real request metadata without request contents', () => {
    const store = new AdminRequestLogStore();

    store.record({
      method: 'GET',
      endpoint: '/api/admin/users',
      statusCode: 200,
      durationMs: 12,
      requestId: 'request-123',
    });

    expect(store.recent()).toEqual([
      expect.objectContaining({
        level: 'info',
        method: 'GET',
        endpoint: '/api/admin/users',
        statusCode: 200,
        durationMs: 12,
        requestId: 'request-123',
      }),
    ]);
    expect(store.recent()[0]).not.toHaveProperty('headers');
    expect(store.recent()[0]).not.toHaveProperty('body');
    expect(store.recent()[0]).not.toHaveProperty('ip');
  });

  it('summarizes the bounded five-minute request window', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T00:00:00Z'));
    const store = new AdminRequestLogStore();
    store.record({
      method: 'GET',
      endpoint: '/api/health',
      statusCode: 200,
      durationMs: 10,
      requestId: 'request-ok',
    });
    store.record({
      method: 'GET',
      endpoint: '/api/failure',
      statusCode: 503,
      durationMs: 30,
      requestId: 'request-error',
    });

    expect(store.summary()).toEqual({
      total: 2,
      errors: 1,
      averageDurationMs: 20,
      windowMinutes: 5,
    });
    jest.useRealTimers();
  });
});
