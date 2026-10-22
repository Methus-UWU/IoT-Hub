import { ConfigService } from '@nestjs/config';
import { ModelCatalogService } from './model-catalog.service';

describe('admin catalog latency order', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shares concurrent requests and caches provider ordering without changing the catalog', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'fast/model' }, {}, { id: 'slow/model' }],
      }),
    } as Response);
    const catalog = new ModelCatalogService(new ConfigService());
    const results = await Promise.all([
      catalog.latencyOrder(),
      catalog.latencyOrder(),
    ]);
    expect(results).toEqual([
      ['fast/model', 'slow/model'],
      ['fast/model', 'slow/model'],
    ]);
    expect(await catalog.latencyOrder()).toEqual(results[0]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models?sort=latency-low-to-high',
      expect.any(Object),
    );
  });

  it('keeps failed latency reads optional and retries after the failure cache expires', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('offline'));
    const catalog = new ModelCatalogService(new ConfigService());
    expect(await catalog.latencyOrder()).toEqual([]);
    expect(await catalog.latencyOrder()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now.mockReturnValue(62_000);
    expect(await catalog.latencyOrder()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
