import { HttpException, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AiCreditsService } from '../../ai-credits/ai-credits.service';
import { allDevices } from '../../projects/catalog/device-catalog';
import { AiChatResult, AiService } from '../ai.service';
import { AiTaskProfile } from '../dto/ai-chat.dto';
import { GeminiProvider } from '../providers/gemini.provider';
import { AdvisorMode, IotAdvisorChatDto } from './iot-advisor.dto';

const BASE_PROMPT = `You are the IoT Hub advisor, helping makers build Internet of Things projects with ESP32 and Arduino boards.
Answer in the user's language (usually Thai). Be concrete and practical.

You help with:
- Choosing suitable devices for a project, and saying why.
- Wiring a device to the board: which board pin to each device pin, supply voltage, and any resistor, level shifter, or separate supply it needs. Use a table: device pin | board pin | note.
- Basic example code for a device. Give Arduino C++ that works in the Arduino IDE, then state the PlatformIO setup: the platformio.ini [env] lines (platform, board, framework = arduino) and the lib_deps entries. In PlatformIO the sketch lives in src/main.cpp and needs #include <Arduino.h> with functions declared before use.

Pin safety on ESP32: GPIO 6-11 are wired to flash and must not be used; GPIO 34-39 are input only with no pull-ups; GPIO 0, 2, 5, 12, and 15 are strapping pins that affect boot; ADC2 pins cannot be read while Wi-Fi is on; the chip is 3.3 V and not 5 V tolerant.
On Arduino Uno and Nano: pins 0 and 1 are the USB serial port; A4/A5 are I2C; the board is 5 V logic.

Prefer the parts listed below, which the platform can simulate on its virtual device canvas, and say so when you recommend one. Recommend another part when none of them fits.
Never claim to have run code or tested hardware. If a question needs information you do not have (the exact module, board, or wiring), ask for it.`;

const ERROR_PROMPT = `The user is asking you to analyse an error from the Arduino IDE or PlatformIO (compiler, linker, upload, or serial output).
Structure the answer:
1. What the error means, quoting the decisive line and file:line verbatim.
2. The most likely cause, then other possible causes in order of likelihood.
3. Step-by-step fixes, with corrected code or configuration where it applies. For PlatformIO this may be platformio.ini (board, lib_deps, monitor_speed, upload_port).
4. How to confirm the fix worked.
Common families to recognise: a missing library or header (install it, or add lib_deps); "was not declared in this scope" (a typo, a missing include, or in a .cpp a function used before its declaration); the wrong board selected; upload failures such as "Failed to connect to ESP32: Timed out waiting for packet header" (hold BOOT, check the cable and port) or "avrdude: stk500_recv(): programmer is not responding" (wrong port, board, or bootloader); sketch too big or RAM overflow; brownout or boot-loop resets in the serial monitor.
If the pasted text is only part of the log, say which earlier lines would help.`;

/** The parts the platform catalogs, one line per category, for the prompt. */
function catalogSummary(): string {
  const byCategory = new Map<string, string[]>();
  for (const device of allDevices()) {
    const names = byCategory.get(device.category) ?? [];
    names.push(device.name);
    byCategory.set(device.category, names);
  }
  return [...byCategory]
    .map(([category, names]) => `- ${category}: ${names.join(', ')}`)
    .join('\n');
}

/** A log-safe summary: the status and message we composed, never an upstream body. */
function describe(error: unknown): string {
  if (error instanceof HttpException) {
    return `${error.getStatus()} ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The general-purpose IoT assistant for signed-in users: device choice, wiring,
 * example code, and error analysis, outside any one project.
 *
 * It has no tools and reads no user data, so it can only advise. Answers come
 * from Gemini when it is configured, which keeps the OpenRouter quota for project
 * generation; any Gemini failure falls back to OpenRouter through
 * `AiService.complete` and its shared model policy.
 */
@Injectable()
export class IotAdvisorService {
  private readonly logger = new Logger(IotAdvisorService.name);
  private readonly catalog = catalogSummary();

  constructor(
    private readonly ai: AiService,
    private readonly gemini: GeminiProvider,
    @Optional() private readonly credits?: AiCreditsService,
  ) {}

  /** Checks the allowance first, then charges the completed answer's token usage. */
  async chatFor(
    userId: string,
    dto: IotAdvisorChatDto,
    signal?: AbortSignal,
  ): Promise<AiChatResult> {
    await this.credits?.assertCanUse(userId);
    const result = await this.chat(dto, signal);
    await this.credits?.record(userId, 'advisor', result.model, result.usage);
    return result;
  }

  async chat(
    dto: IotAdvisorChatDto,
    signal?: AbortSignal,
  ): Promise<AiChatResult> {
    const systemPrompt = this.systemPrompt(dto.mode ?? 'advice');
    // Error logs reward a careful read; everyday advice does not need one.
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
        // The user left: there is nobody to answer, so do not spend a second call.
        signal?.throwIfAborted();
        this.logger.warn(
          `Gemini failed, falling back to OpenRouter: ${describe(error)}`,
        );
      }
    }

    return this.ai.complete(
      {
        systemPrompt,
        messages: dto.messages,
        profile,
        modelOrder: (await this.credits?.modelOrder()) ?? [],
      },
      signal,
    );
  }

  private systemPrompt(mode: AdvisorMode): string {
    return [
      BASE_PROMPT,
      mode === 'error' ? ERROR_PROMPT : '',
      `Parts available on the platform:\n${this.catalog}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }
}
