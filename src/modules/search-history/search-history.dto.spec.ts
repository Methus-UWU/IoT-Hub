import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RecordSearchDto } from './dto/search-history.dto';

describe('RecordSearchDto', () => {
  it('collapses whitespace so repeats share one entry', async () => {
    const dto = plainToInstance(RecordSearchDto, {
      scope: 'documents',
      query: '  dht   22 ',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.query).toBe('dht 22');
  });

  it.each([
    { scope: 'projects', query: 'relay' },
    { scope: 'community', query: '   ' },
    { scope: 'community', query: 'x'.repeat(101) },
  ])('rejects %j', async (input) => {
    const dto = plainToInstance(RecordSearchDto, input);
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
