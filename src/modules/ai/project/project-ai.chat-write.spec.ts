import { ConfigService } from '@nestjs/config';

import { ProjectFilesService } from '../../projects/project-files.service';
import { Project } from '../../projects/project.repository';
import { CatalogModel } from '../providers/model-catalog.types';
import { ModelCatalogService } from '../providers/model-catalog.service';
import { ModelSelectorService } from '../providers/model-selector.service';
import { OpenRouterProvider } from '../providers/openrouter.provider';
import {
  AiProviderRequest,
  AiProviderResult,
} from '../providers/ai-provider.types';
import { AiPlanApplyService } from './ai-plan-apply.service';
import { ProjectAiService } from './project-ai.service';
import { ProjectContextService } from './project-context.service';
import { AiTaskProfile } from '../dto/ai-chat.dto';

/**
 * The one path a user actually feels: "change my sketch" must end with the sketch
 * changed on the server.
 *
 * Every piece of this pipeline already has unit coverage, and all of it passes while the
 * complaint — the code never changes — stays true. So this test deliberately spans the
 * whole seam instead: a real `ProjectAiService` turn with only the model stubbed, its
 * plan handed to a real `AiPlanApplyService`, and the assertion made against the file
 * store rather than against the plan. A regression anywhere between the tool call and
 * the write lands here.
 */

const MAIN = 'src/main.ino';

const ORIGINAL = [
  '#include <WiFi.h>',
  '#include <WebServer.h>',
  '#include "config.h"',
  '',
  'WebServer server(80);',
  'const int SOIL_SENSOR = 34;',
  '',
  'void sendTelemetry() {',
  '  int soil = analogRead(SOIL_SENSOR);',
  '  String payload = "{\\"soil\\":" + String(soil) + "}";',
  '  server.send(200, "application/json", payload);',
  '}',
  '',
  'void setup() {',
  '  Serial.begin(115200);',
  '  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);',
  '}',
  '',
  'void loop() {',
  '  server.handleClient();',
  '}',
].join('\n');

/** The same sketch with one line added — what a well-behaved model returns. */
const PATCHED = ORIGINAL.replace(
  '  server.handleClient();',
  '  server.handleClient();\n  delay(10);',
);

const PROJECT: Project = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'soil',
  slug: 'soil',
  description: '',
  board: 'ESP32 DevKit V1',
  framework: 'Arduino C++',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MODEL: CatalogModel = {
  id: 'stub/model',
  name: 'Stub',
  vendor: 'stub',
  description: '',
  contextLength: 128_000,
  promptPricePerMillion: 0,
  completionPricePerMillion: 0,
  isFree: true,
  supportsReasoning: false,
  supportsTools: true,
  moderated: false,
};

/** The project's stored files, shared by the context, the draft and the apply step. */
class FileStore {
  private readonly files = new Map<
    string,
    { content: string; version: number }
  >([[MAIN, { content: ORIGINAL, version: 1 }]]);

  contentOf(path: string): string | undefined {
    return this.files.get(path)?.content;
  }

  readonly service = {
    list: () =>
      Promise.resolve(
        [...this.files].map(([path, file]) => ({
          path,
          sizeBytes: file.content.length,
        })),
      ),
    read: (_projectId: string, path: string) => {
      const file = this.files.get(path);
      if (!file) return Promise.reject(new Error(`No such file: ${path}`));
      return Promise.resolve({ path, ...file });
    },
    save: (
      _projectId: string,
      input: { path: string; content: string; expectedVersion?: number },
    ) => {
      const existing = this.files.get(input.path);
      this.files.set(input.path, {
        content: input.content,
        version: (existing?.version ?? 0) + 1,
      });
      return Promise.resolve({ path: input.path, content: input.content });
    },
  } as unknown as ProjectFilesService;
}

/** A model that reads the file and returns it patched, in two tool rounds. */
function scriptedProvider(store: FileStore): {
  provider: OpenRouterProvider;
  requests: AiProviderRequest[];
} {
  const requests: AiProviderRequest[] = [];
  let round = 0;

  const provider = {
    generate: (request: AiProviderRequest): Promise<AiProviderResult> => {
      requests.push(request);
      round += 1;

      if (round === 1) {
        return Promise.resolve({
          content: '',
          toolCalls: [
            {
              id: 'call-read',
              name: 'read_source_file',
              rawArguments: JSON.stringify({ path: MAIN }),
            },
          ],
        } as AiProviderResult);
      }

      if (round === 2) {
        return Promise.resolve({
          content: '',
          toolCalls: [
            {
              id: 'call-write',
              name: 'write_source_file',
              rawArguments: JSON.stringify({
                path: MAIN,
                content: PATCHED,
              }),
            },
          ],
        } as AiProviderResult);
      }

      return Promise.resolve({
        content: 'เพิ่ม delay(10) ใน loop แล้วครับ',
      } as AiProviderResult);
    },
  } as unknown as OpenRouterProvider;

  void store;
  return { provider, requests };
}

function buildService(store: FileStore, provider: OpenRouterProvider) {
  const context = new ProjectContextService(
    {
      load: () => Promise.resolve({ components: [], connections: [] }),
    } as never,
    store.service,
  );

  const catalog = {
    load: () => Promise.resolve({ models: [MODEL] }),
  } as unknown as ModelCatalogService;

  const selector = {
    inferProfile: () => AiTaskProfile.Balanced,
    eligible: (models: CatalogModel[]) => models,
    rank: (models: CatalogModel[]) =>
      models.map((model) => ({ model, score: 1 })),
  } as unknown as ModelSelectorService;

  const config = { get: () => undefined } as unknown as ConfigService;

  return new ProjectAiService(context, catalog, selector, provider, config);
}

describe('project AI: a code change reaches the file store', () => {
  it('stages a write in the plan and applies it to the file', async () => {
    const store = new FileStore();
    const { provider } = scriptedProvider(store);
    const service = buildService(store, provider);

    const result = await service.chat(PROJECT, {
      messages: [{ role: 'user', content: 'ใส่ delay(10) ใน loop ให้หน่อย' }],
      activeFile: MAIN,
    } as never);

    // The turn must come back with a code action. A plan-less answer is the failure the
    // user reports as "the code never changes", so it is asserted before anything else.
    expect(result.plan).toBeDefined();
    expect(result.plan?.preview).toEqual([
      { kind: 'code', text: `Modify ${MAIN}` },
    ]);

    const apply = new AiPlanApplyService(
      {
        load: () => Promise.resolve({ components: [], connections: [] }),
      } as never,
      { add: () => Promise.reject(new Error('not used')) } as never,
      { add: () => Promise.reject(new Error('not used')) } as never,
      store.service,
    );

    const applied = await apply.apply('user-1', PROJECT, [
      ...(result.plan?.actions ?? []),
    ] as never);

    expect(applied.filesWritten).toEqual([MAIN]);
    expect(store.contentOf(MAIN)).toBe(PATCHED);
    expect(store.contentOf(MAIN)).toContain('delay(10);');
    // The rest of the sketch survived: this is the failure the write tool's size floor
    // exists to catch, so it is worth asserting rather than trusting.
    expect(store.contentOf(MAIN)).toContain(
      'WiFi.begin(WIFI_SSID, WIFI_PASSWORD);',
    );
  });

  it('refuses a rewrite that would delete most of the sketch', async () => {
    const store = new FileStore();
    const stub = 'void setup() {}\nvoid loop() {}';

    const provider = (() => {
      let round = 0;
      return {
        generate: (): Promise<AiProviderResult> => {
          round += 1;
          if (round === 1) {
            return Promise.resolve({
              content: '',
              toolCalls: [
                {
                  id: 'call-write',
                  name: 'write_source_file',
                  rawArguments: JSON.stringify({ path: MAIN, content: stub }),
                },
              ],
            } as AiProviderResult);
          }
          return Promise.resolve({
            content: 'ทำไม่ได้ครับ',
          } as AiProviderResult);
        },
      } as unknown as OpenRouterProvider;
    })();

    const result = await buildService(store, provider).chat(PROJECT, {
      messages: [{ role: 'user', content: 'เขียนใหม่ทั้งไฟล์' }],
      activeFile: MAIN,
    } as never);

    expect(result.plan).toBeUndefined();
    expect(store.contentOf(MAIN)).toBe(ORIGINAL);
  });
});
