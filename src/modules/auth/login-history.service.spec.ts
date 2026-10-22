import { LoginHistoryService } from './login-history.service';

describe('LoginHistoryService', () => {
  const record = jest.fn();
  const service = new LoginHistoryService({
    record,
    listForUser: jest.fn(),
  });
  const sessionId = '6f1c2f8e-3b1a-4c55-9d3e-2a7b9c0d1e2f';

  beforeEach(() => record.mockReset());

  it('records the verified session with the request address and device', async () => {
    await service.record(
      { id: 'user-1', email: 'a@example.com', sessionId },
      '203.0.113.7',
      'Mozilla/5.0',
    );
    expect(record).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId,
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('bounds oversized headers instead of rejecting the sign-in', async () => {
    await service.record(
      { id: 'user-1', email: 'a@example.com', sessionId },
      undefined,
      'x'.repeat(2000),
    );
    const [input] = record.mock.calls[0] as [
      { ipAddress: string; userAgent: string },
    ];
    expect(input.ipAddress).toBe('');
    expect(input.userAgent).toHaveLength(512);
  });

  it.each([undefined, 'not-a-uuid'])(
    'records nothing for a token without a usable session id (%s)',
    async (id) => {
      await service.record(
        { id: 'user-1', email: 'a@example.com', sessionId: id },
        '203.0.113.7',
        'Mozilla/5.0',
      );
      expect(record).not.toHaveBeenCalled();
    },
  );
});
