import 'reflect-metadata';

import { HttpException, HttpStatus } from '@nestjs/common';

import { AiService } from '../ai.service';
import { AiTaskProfile } from '../dto/ai-chat.dto';
import { GeminiProvider } from '../providers/gemini.provider';
import { IotAdvisorService } from './iot-advisor.service';

describe('IotAdvisorService', () => {
  const complete = jest.fn().mockResolvedValue({ content: 'ok' });
  const generate = jest.fn();
  const gemini = { configured: false, generate };
  const service = new IotAdvisorService(
    { complete } as unknown as AiService,
    gemini as unknown as GeminiProvider,
  );
  const messages = [
    { role: 'user' as const, content: 'DHT22 กับ ESP32 ต่อยังไง' },
  ];

  beforeEach(() => {
    complete.mockClear();
    generate.mockReset();
    gemini.configured = false;
  });

  function lastRequest() {
    return (
      complete.mock.calls[0] as [
        { systemPrompt: string; profile: AiTaskProfile },
      ]
    )[0];
  }

  it('grounds advice in the platform catalog and covers both toolchains', async () => {
    await service.chat({ messages });
    const request = lastRequest();
    expect(request.profile).toBe(AiTaskProfile.Balanced);
    expect(request.systemPrompt).toContain('Arduino IDE');
    expect(request.systemPrompt).toContain('platformio.ini');
    expect(request.systemPrompt).toMatch(/DHT22/i);
    expect(request.systemPrompt).not.toContain('analyse an error');
  });

  it('adds the error-analysis instructions and a deeper model in error mode', async () => {
    await service.chat({ mode: 'error', messages });
    const request = lastRequest();
    expect(request.profile).toBe(AiTaskProfile.Deep);
    expect(request.systemPrompt).toContain('analyse an error');
  });

  describe('with Gemini configured', () => {
    beforeEach(() => {
      gemini.configured = true;
    });

    it('answers through Gemini and leaves OpenRouter untouched', async () => {
      generate.mockResolvedValue({ content: 'จาก Gemini', model: 'gemini-x' });

      const reply = await service.chat({ mode: 'error', messages });

      expect(reply).toMatchObject({
        content: 'จาก Gemini',
        model: 'gemini-x',
        vendor: 'google',
        profile: AiTaskProfile.Deep,
      });
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages,
          reasoningEffort: 'medium',
          systemPrompt: expect.stringContaining('analyse an error') as string,
        }),
      );
      expect(complete).not.toHaveBeenCalled();
    });

    it('falls back to OpenRouter with the same prompt when Gemini is rate limited', async () => {
      generate.mockRejectedValue(
        new HttpException('limited', HttpStatus.TOO_MANY_REQUESTS),
      );

      const reply = await service.chat({ messages });

      expect(reply).toMatchObject({ content: 'ok' });
      expect(lastRequest().systemPrompt).toBe(
        (generate.mock.calls[0] as [{ systemPrompt: string }])[0].systemPrompt,
      );
    });

    it('does not spend a fallback call once the caller has gone', async () => {
      const controller = new AbortController();
      generate.mockImplementation(() => {
        controller.abort();
        return Promise.reject(new Error('aborted'));
      });

      await expect(
        service.chat({ messages }, controller.signal),
      ).rejects.toBeDefined();
      expect(complete).not.toHaveBeenCalled();
    });
  });
});
