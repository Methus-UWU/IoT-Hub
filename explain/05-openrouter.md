# 05 · AI เชื่อมต่อ OpenRouter อย่างไร

OpenRouter เป็นตัวกลางที่รวมโมเดลหลายเจ้า (Llama, Qwen, DeepSeek, Gemini ฯลฯ) ไว้หลัง API เดียว
ใช้รูปแบบเดียวกับ OpenAI `/chat/completions` backend เรียกด้วย `fetch` ตรง ๆ ไม่ได้ใช้ SDK

## ค่าที่ต้องตั้ง (ใน `backend/.env`)

ดูคำอธิบายทุกตัวได้ใน [`backend/.env.example`](../backend/.env.example)

| ตัวแปร | ความหมาย |
| --- | --- |
| `OPENROUTER_API_KEY` | **จำเป็น** key ของ OpenRouter |
| `OPENROUTER_BASE_URL` | ค่าเริ่มต้น `https://openrouter.ai/api/v1` |
| `AI_PROJECT_MODEL` | บังคับโมเดลที่ใช้ก่อน (คั่นด้วย comma) |
| `AI_ALLOW_PAID_MODELS` | `true` = ให้จัดอันดับโมเดลเสียเงินด้วย (ค่าเริ่มต้นใช้แค่ `:free`) |
| `AI_PROVIDER_SORT` | `latency` / `price` / `throughput` ให้ OpenRouter เลือก endpoint |
| `AI_MAX_OUTPUT_TOKENS` | เพดาน token ของคำตอบ (ค่าเริ่มต้น 16,000) |
| `AI_CATALOG_TTL_MS` | อายุ cache ของรายชื่อโมเดล (ค่าเริ่มต้น 1 ชั่วโมง) |
| `AI_FALLBACK_MODEL` | โมเดลสำรองเมื่อดึงรายชื่อโมเดลไม่ได้ |
| `GEMINI_API_KEY` | ไม่บังคับ ถ้าตั้งไว้ advisor จะใช้ Gemini ก่อน |

Key ทั้งหมดอยู่ฝั่ง backend เท่านั้น browser ไม่เคยเห็น

## ขั้นที่ 1 · โหลดรายชื่อโมเดล

[`model-catalog.service.ts`](../backend/src/modules/ai/providers/model-catalog.service.ts)

- บรรทัด 7: `DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'`
- บรรทัด 115 `baseUrl`: ใช้ `OPENROUTER_BASE_URL` ถ้ามี
- บรรทัด 123 `load()`: ส่งรายชื่อจาก cache ถ้ายังไม่หมดอายุ ไม่งั้นเรียก `GET {baseUrl}/models` (บรรทัด 170)
  - ได้ข้อมูลแต่ละโมเดล: context length, รองรับ tool ไหม, ราคา, ฟรีไหม (`id.endsWith(':free')` บรรทัด 199)
  - ถ้าเรียกไม่ได้ จะใช้ catalog ล่าสุดที่เคยได้ หรือ `AI_FALLBACK_MODEL` (187–188)

## ขั้นที่ 2 · เลือกโมเดล

[`model-selector.service.ts`](../backend/src/modules/ai/providers/model-selector.service.ts)

| ฟังก์ชัน | บรรทัด | ทำอะไร |
| --- | --- | --- |
| `inferProfile()` | 165 | เดาโหมดจากข้อความ: ยาวหรือต้องวิเคราะห์ = `deep`, สั้น = `fast`, ที่เหลือ = `balanced` |
| `eligible()` | 182 | ตัดโมเดลเสียเงินออก ถ้าไม่ได้ตั้ง `AI_ALLOW_PAID_MODELS=true` |
| `rank()` | 200 | ให้คะแนนตามน้ำหนักของ profile (คุณภาพ ความเร็ว context ฯลฯ) แล้วเรียงจากมากไปน้อย |

ใน project assistant ([`project-ai.service.ts`](../backend/src/modules/ai/project/project-ai.service.ts)):

- บรรทัด 278–282: ใช้โมเดลที่ผู้ใช้เลือก หรือ `withPinnedModel` (504) ที่วาง `AI_PROJECT_MODEL` ไว้หน้าสุด ต่อด้วยผลจัดอันดับ
- `resolveByProfile` (533) เลือกโมเดลที่รองรับ tool ก่อน และเก็บไว้สูงสุด 3 ตัว (`MAX_MODEL_CANDIDATES`)

## ขั้นที่ 3 · ส่งคำขอ

[`openrouter.provider.ts`](../backend/src/modules/ai/providers/openrouter.provider.ts)

### `generate()` บรรทัด 65
เรียก `request()` ถ้าได้คำตอบว่างจะลองซ้ำ 1 ครั้ง ถ้าว่างอีกจะตอบ `AI_PROVIDER_EMPTY` (502)

### `request()` บรรทัด 90

```http
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer $OPENROUTER_API_KEY
Content-Type: application/json

{
  "models": ["โมเดลหลัก", "สำรอง 1", "สำรอง 2"],
  "messages": [
    { "role": "system", "content": "<system prompt + context ของโปรเจกต์>" },
    { "role": "user", "content": "..." },
    { "role": "assistant", "tool_calls": [...] },
    { "role": "tool", "tool_call_id": "...", "content": "<ผลของ tool>" }
  ],
  "max_tokens": 16000,
  "tools": [{ "type": "function", "function": { "name", "description", "parameters" } }],
  "provider": { "require_parameters": true, "sort": "latency" }
}
```

`models` เรียงโมเดลหลักไว้หน้าสุด ถ้าตัวแรกล่ม OpenRouter จะสลับไปใช้ตัวถัดไปเอง

| บรรทัด | รายละเอียด |
| --- | --- |
| 92–96 | ไม่มี key → 503 |
| 107–109 | มีโมเดลสำรอง → ส่งเป็น `models: [...]` ไม่งั้นส่ง `model` |
| 110–113 | แปลงประวัติแชตด้วย `toWireMessage()` (217) ให้เป็นรูปแบบ OpenAI |
| 115–131 | แนบ `tools` และ `provider.require_parameters` ไม่ส่ง `tool_choice` เพราะจะทำให้ OpenRouter ตัด endpoint ออกจนเหลือ 404 |
| 137–142 | timeout ต่อรอบ 180 วินาที (`ROUND_TIMEOUT_MS` บรรทัด 31) รวมกับ signal ยกเลิกจากผู้ใช้ |
| 155–176 | แปลง error: 429 → `AI_RATE_LIMITED` อื่น ๆ → `AI_PROVIDER_ERROR` ไม่ส่งรายละเอียดจาก OpenRouter ต่อเพราะอาจมีเนื้อหาคำขออยู่ |
| 179–182 | อ่าน `choices[0].message.content` และ `tool_calls` (`readToolCalls` บรรทัด 245) |
| 191–206 | ส่งกลับ `{ content, toolCalls, servedModel, truncated, usage }` |

`truncated: true` หมายถึงคำตอบโดนตัดที่เพดาน token ถ้า tool call ขาดกลางคัน service จะบอกโมเดลให้ส่งใหม่แบบสั้นลง

## IoT Advisor: Gemini ก่อน แล้วค่อย OpenRouter

[`iot-advisor.service.ts:73`](../backend/src/modules/ai/advisor/iot-advisor.service.ts#L73) `chat()`

1. ถ้ามี `GEMINI_API_KEY` → `gemini.generate()` (84) เรียก endpoint แบบ OpenAI-compatible ของ Google ([`gemini.provider.ts:15`](../backend/src/modules/ai/providers/gemini.provider.ts#L15))
2. ถ้า Gemini พัง → log `Gemini failed, falling back to OpenRouter` (103) แล้วใช้ `this.ai.complete(...)` (108) ซึ่งไปทาง OpenRouter
3. system prompt ของ advisor แนบรายชื่ออุปกรณ์ที่แพลตฟอร์มรองรับ (`systemPrompt()` บรรทัด 114)

แยกแบบนี้เพื่อเก็บโควตา OpenRouter ไว้ให้งานสร้างโปรเจกต์ ซึ่งต้องเรียกโมเดลหลายรอบ

## โค้ดจริง

โค้ดด้านล่างคัดลอกจากไฟล์จริงตามเลขบรรทัดที่ระบุ ตัด comment ออกแล้ว ส่วนอื่นไม่ได้แก้

### โหลดรายชื่อโมเดลจาก OpenRouter

[`model-catalog.service.ts:115–120`](../backend/src/modules/ai/providers/model-catalog.service.ts#L115)

```ts
  get baseUrl(): string {
    return (
      this.config.get<string>('OPENROUTER_BASE_URL')?.replace(/\/$/, '') ||
      DEFAULT_BASE_URL
    );
  }
```

[`model-catalog.service.ts:123–140`](../backend/src/modules/ai/providers/model-catalog.service.ts#L123)

```ts
  async load(): Promise<ModelCatalog> {
    const ttl =
      Number(this.config.get<string>('AI_CATALOG_TTL_MS')) || DEFAULT_TTL_MS;
    const cached = this.cache;
    if (
      cached &&
      !cached.stale &&
      Date.now() - Date.parse(cached.fetchedAt) < ttl
    ) {
      return cached;
    }

    this.inFlight ??= this.refresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
```

### เลือก profile และกรองโมเดล

[`model-selector.service.ts:165–179`](../backend/src/modules/ai/providers/model-selector.service.ts#L165)

```ts
  inferProfile(
    messages: AiChatMessageDto[],
  ): Exclude<AiTaskProfile, AiTaskProfile.Auto> {
    const text = messages.map((message) => message.content).join('\n');
    if (
      text.length >= DEEP_PROMPT_CHARS ||
      messages.length >= DEEP_TURN_COUNT ||
      DEEP_TASK_PATTERN.test(text)
    ) {
      return AiTaskProfile.Deep;
    }
    return text.length <= FAST_PROMPT_CHARS
      ? AiTaskProfile.Fast
      : AiTaskProfile.Balanced;
  }
```

[`model-selector.service.ts:182–186`](../backend/src/modules/ai/providers/model-selector.service.ts#L182)

```ts
  eligible(models: CatalogModel[]): CatalogModel[] {
    return this.allowPaidModels
      ? models
      : models.filter((model) => model.isFree);
  }
```

[`model-selector.service.ts:200–223`](../backend/src/modules/ai/providers/model-selector.service.ts#L200)

```ts
  rank(
    models: CatalogModel[],
    profile: Exclude<AiTaskProfile, AiTaskProfile.Auto>,
  ): RankedModel[] {
    const rule = this.rule(profile);
    const eligible = this.eligible(models);
    const withinFloor = eligible.filter(
      (model) => model.contextLength >= rule.minContextLength,
    );
    const candidates = withinFloor.length ? withinFloor : eligible;
    const now = Date.now();

    return candidates
      .map((model) => {
        const signals = scoreModel(model, now);
        const score = (
          Object.keys(rule.weights) as (keyof ProfileWeights)[]
        ).reduce((total, key) => total + rule.weights[key] * signals[key], 0);
        return { model, score, signals };
      })
      .sort(
        (a, b) => b.score - a.score || a.model.id.localeCompare(b.model.id),
      );
  }
```

### Project assistant เลือกโมเดลที่ใช้จริง

[`project-ai.service.ts:504–523`](../backend/src/modules/ai/project/project-ai.service.ts#L504)

```ts
  private withPinnedModel(
    models: CatalogModel[],
    ranked: CatalogModel[],
  ): CatalogModel[] {
    const pinned = (this.config.get<string>('AI_PROJECT_MODEL') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => models.find((model) => model.id === id))
      .filter((model): model is CatalogModel => Boolean(model));
    if (!pinned.length) return ranked;

    const unique = [
      ...new Map(pinned.map((model) => [model.id, model])).values(),
    ];
    return [
      ...unique,
      ...ranked.filter((model) => !unique.some((pin) => pin.id === model.id)),
    ].slice(0, MAX_MODEL_CANDIDATES);
  }
```

[`project-ai.service.ts:533–550`](../backend/src/modules/ai/project/project-ai.service.ts#L533)

```ts
  private resolveByProfile(
    models: CatalogModel[],
    profile: Exclude<AiTaskProfile, AiTaskProfile.Auto>,
  ): CatalogModel[] {
    const ranked = this.selector.rank(models, profile);
    const withTools = ranked.filter(({ model }) => model.supportsTools);
    const candidates = withTools.length ? withTools : ranked;

    if (!candidates.length) {
      throw new BadRequestException({
        code: 'AI_NO_ELIGIBLE_MODEL',
        message:
          'No AI model in the OpenRouter catalog matches the current policy',
      });
    }

    return candidates.slice(0, MAX_MODEL_CANDIDATES).map(({ model }) => model);
  }
```

### OpenRouterProvider: generate() และ request()

[`openrouter.provider.ts:65–82`](../backend/src/modules/ai/providers/openrouter.provider.ts#L65)

```ts
  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    try {
      return await this.request(request);
    } catch (error) {
      if (!(error instanceof EmptyResponseError)) throw error;
      request.signal?.throwIfAborted();
      try {
        return await this.request(request);
      } catch (retryError) {
        if (!(retryError instanceof EmptyResponseError)) throw retryError;
        throw new BadGatewayException({
          code: 'AI_PROVIDER_EMPTY',
          message:
            'AI ตอบกลับว่าง ๆ สองครั้งติดกัน ยังไม่มีการใช้แผนกับโปรเจกต์ กรุณาลองใหม่อีกครั้ง',
        });
      }
    }
  }
```

[`openrouter.provider.ts:90–205`](../backend/src/modules/ai/providers/openrouter.provider.ts#L90)

```ts
  private async request(request: AiProviderRequest): Promise<AiProviderResult> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY')?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'OpenRouter API key is not configured',
      );
    }

    let response: Response;
    try {
      response = await fetch(`${this.catalog.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...(request.fallbackModels?.length
            ? { models: [request.model, ...request.fallbackModels] }
            : { model: request.model }),
          messages: [
            { role: 'system', content: request.systemPrompt },
            ...request.messages.map(toWireMessage),
          ],
          max_tokens: request.maxOutputTokens,
          ...(request.tools?.length
            ? {
                tools: request.tools.map((tool) => ({
                  type: 'function',
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  },
                })),
                provider: {
                  require_parameters: true,
                  sort: this.providerSort(),
                },
              }
            : {}),
        }),
        signal: request.signal
          ? AbortSignal.any([
              request.signal,
              AbortSignal.timeout(ROUND_TIMEOUT_MS),
            ])
          : AbortSignal.timeout(ROUND_TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('OpenRouter is unavailable or timed out');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const upstreamError = asRecord(asRecord(payload)?.['error']);
    if (!response.ok || upstreamError) {
      const status = numberValue(upstreamError?.['code']) ?? response.status;
      if (status === 429) {
        throw new HttpException(
          {
            code: 'AI_RATE_LIMITED',
            message:
              'ผู้ให้บริการ AI จำกัดจำนวนคำขอในขณะนี้ กรุณาลองใหม่ภายหลัง ยังไม่มีการใช้แผนกับโปรเจกต์',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new BadGatewayException({
        code: 'AI_PROVIDER_ERROR',
        message: `AI provider request failed (${status}). Please try again.`,
      });
    }

    const record = asRecord(payload);
    if (!record) throw new EmptyResponseError();

    const choice = asRecord(asArray(record['choices'])[0]);
    const message = asRecord(choice?.['message']);
    const text = stringValue(message?.['content']) ?? '';
    const toolCalls = readToolCalls(message?.['tool_calls']);

    if (!text && !toolCalls.length) {
      throw new EmptyResponseError();
    }

    const usage = asRecord(record['usage']);
    return {
      content: text,
      ...(toolCalls.length ? { toolCalls } : {}),
      servedModel: stringValue(record['model']),
      ...(stringValue(choice?.['finish_reason']) === 'length'
        ? { truncated: true }
        : {}),
      usage: usage
        ? {
            inputTokens: numberValue(usage['prompt_tokens']),
            outputTokens: numberValue(usage['completion_tokens']),
          }
        : undefined,
    };
  }
```

### แปลงประวัติแชตเป็นรูปแบบ OpenAI และอ่าน tool_calls

[`openrouter.provider.ts:217–242`](../backend/src/modules/ai/providers/openrouter.provider.ts#L217)

```ts
function toWireMessage(
  turn: AiConversationTurn | { role: string; content: string },
) {
  if ('toolCallId' in turn) {
    return {
      role: 'tool',
      tool_call_id: turn.toolCallId,
      name: turn.name,
      content: turn.content,
    };
  }

  if ('toolCalls' in turn) {
    return {
      role: 'assistant',
      content: turn.content || null,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.rawArguments },
      })),
    };
  }

  return { role: turn.role, content: turn.content };
}
```

[`openrouter.provider.ts:245–265`](../backend/src/modules/ai/providers/openrouter.provider.ts#L245)

```ts
function readToolCalls(value: unknown): AiToolCall[] {
  const calls: AiToolCall[] = [];

  for (const entry of asArray(value)) {
    const record = asRecord(entry);
    const fn = asRecord(record?.['function']);
    const name = stringValue(fn?.['name']);
    const id = stringValue(record?.['id']);
    if (!name || !id) continue;

    calls.push({
      id,
      name,
      rawArguments: stringValue(fn?.['arguments'])?.trim() || '{}',
    });
  }

  return calls;
}
```

### Advisor: Gemini ก่อน แล้ว fallback ไป OpenRouter

[`iot-advisor.service.ts:73–113`](../backend/src/modules/ai/advisor/iot-advisor.service.ts#L73)

```ts
  async chat(
    dto: IotAdvisorChatDto,
    signal?: AbortSignal,
  ): Promise<AiChatResult> {
    const systemPrompt = this.systemPrompt(dto.mode ?? 'advice');
    const profile =
      dto.mode === 'error' ? AiTaskProfile.Deep : AiTaskProfile.Balanced;

    if (this.gemini.configured) {
      try {
        const reply = await this.gemini.generate({
          systemPrompt,
          messages: dto.messages,
          reasoningEffort: profile === AiTaskProfile.Deep ? 'medium' : 'low',
          signal,
        });
        return {
          id: randomUUID(),
          model: reply.model,
          vendor: 'google',
          profile,
          autoSelected: true,
          content: reply.content,
          createdAt: new Date().toISOString(),
          usage: reply.usage,
        };
      } catch (error) {
        signal?.throwIfAborted();
        this.logger.warn(
          `Gemini failed, falling back to OpenRouter: ${describe(error)}`,
        );
      }
    }

    return this.ai.complete(
      { systemPrompt, messages: dto.messages, profile },
      signal,
    );
  }
```
