import { ConfigService } from '@nestjs/config';

import { AiTaskProfile } from '../dto/ai-chat.dto';
import { CatalogModel } from './model-catalog.types';
import { ModelSelectorService } from './model-selector.service';

/**
 * The ranking decides which model a tier actually reaches, so the rules that are
 * categorical rather than scored belong in a spec: a tier that silently picks a model
 * it cannot use is indistinguishable, from the user's side, from the feature being
 * broken.
 */

function model(
  overrides: Partial<CatalogModel> & { id: string },
): CatalogModel {
  return {
    name: overrides.id,
    vendor: overrides.id.split('/')[0] ?? 'test',
    description: '',
    contextLength: 262_144,
    promptPricePerMillion: 0,
    completionPricePerMillion: 0,
    isFree: true,
    supportsReasoning: false,
    supportsTools: true,
    moderated: false,
    ...overrides,
  };
}

describe('ModelSelectorService', () => {
  const selector = new ModelSelectorService(new ConfigService({}));

  it('keeps reasoning models for the profile that asks for them', () => {
    const reasoning = model({
      id: 'vendor/deep-70b:free',
      supportsReasoning: true,
    });
    const plain = model({ id: 'vendor/plain-70b:free' });

    const ranked = selector.rank([reasoning, plain], AiTaskProfile.Deep);

    expect(ranked[0].model.id).toBe(reasoning.id);
  });

  it('keeps paid models out of the ranking unless the operator opts in', () => {
    const paid = model({
      id: 'vendor/paid-70b',
      isFree: false,
      promptPricePerMillion: 3,
      completionPricePerMillion: 6,
    });
    const free = model({ id: 'vendor/free-70b:free' });

    const ranked = selector.rank([paid, free], AiTaskProfile.Balanced);

    expect(ranked.map(({ model: item }) => item.id)).toEqual([free.id]);
  });
});
