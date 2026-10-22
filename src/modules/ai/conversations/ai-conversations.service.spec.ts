import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { AuthorizationService } from '../../authorization/authorization.service';
import type { Project } from '../../projects/project.repository';
import { AiTaskProfile } from '../dto/ai-chat.dto';
import type { ProjectChatDto } from '../project/dto/project-ai.dto';
import type {
  ProjectAiService,
  ProjectChatOptions,
  ProjectChatResult,
} from '../project/project-ai.service';
import {
  AiConversationsService,
  MAX_CONVERSATIONS_PER_PROJECT,
} from './ai-conversations.service';
import {
  FakeAiConversationRepository,
  FakeAiProfileRepository,
} from './ai-conversations.fake';
import {
  AiProfilesService,
  MAX_PERSONAL_PROFILES,
} from './ai-profiles.service';
import { ProjectChatTurnsService } from './project-chat-turns.service';

const ALICE = 'alice';
const BOB = 'bob';
const ADMIN = 'admin';
const PROJECT = 'project-1';
const OTHER_PROJECT = 'project-2';

const authorization = {
  isPlatformAdmin: (userId: string) => Promise.resolve(userId === ADMIN),
  requirePlatformAdmin: (userId: string) =>
    userId === ADMIN
      ? Promise.resolve()
      : Promise.reject(new ForbiddenException({ code: 'ADMIN_ROLE_REQUIRED' })),
} as unknown as AuthorizationService;

const input = (name: string) => ({
  name,
  description: '',
  model: null,
  tier: 'auto' as const,
  instructions: '',
});

class FakeAssistant {
  readonly calls: { dto: ProjectChatDto; options?: ProjectChatOptions }[] = [];
  plan: ProjectChatResult['plan'];

  chat(
    _project: Project,
    dto: ProjectChatDto,
    _signal?: AbortSignal,
    _progress?: unknown,
    options?: ProjectChatOptions,
  ): Promise<ProjectChatResult> {
    this.calls.push({ dto, options });
    return Promise.resolve({
      id: 'turn',
      model: dto.model ?? 'ranked/model',
      vendor: 'test',
      profile: dto.profile ?? AiTaskProfile.Auto,
      autoSelected: !dto.model,
      content: `answer ${this.calls.length}`,
      createdAt: '2026-10-11T00:00:00Z',
      ...(this.plan ? { plan: this.plan } : {}),
    });
  }
}

describe('AI profiles and conversations', () => {
  let profileRows: FakeAiProfileRepository;
  let conversationRows: FakeAiConversationRepository;
  let profiles: AiProfilesService;
  let conversations: AiConversationsService;
  let assistant: FakeAssistant;
  let turns: ProjectChatTurnsService;
  const project = { id: PROJECT } as Project;
  const signal = new AbortController().signal;

  beforeEach(() => {
    profileRows = new FakeAiProfileRepository();
    conversationRows = new FakeAiConversationRepository();
    profiles = new AiProfilesService(profileRows, authorization);
    conversations = new AiConversationsService(conversationRows, profiles);
    assistant = new FakeAssistant();
    turns = new ProjectChatTurnsService(
      assistant as unknown as ProjectAiService,
      conversations,
      conversationRows,
      profiles,
    );
  });

  describe('profiles', () => {
    it('shows system profiles to everyone and personal ones only to their owner', async () => {
      await profiles.create(ADMIN, input('IoT Assistant'), 'system');
      await profiles.create(ALICE, input('Debug'), 'personal');

      const forBob = await profiles.list(BOB);
      expect(
        forBob.map((profile) => [
          profile.name,
          profile.scope,
          profile.editable,
        ]),
      ).toEqual([['IoT Assistant', 'system', false]]);
      const forAdmin = await profiles.list(ADMIN);
      expect(forAdmin.map((profile) => profile.editable)).toEqual([true]);
      expect(
        (await profiles.list(ALICE)).map((profile) => profile.name),
      ).toEqual(['IoT Assistant', 'Debug']);
    });

    it('lets only admins create or change system profiles', async () => {
      await expect(
        profiles.create(ALICE, input('Global'), 'system'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const system = await profiles.create(ADMIN, input('Global'), 'system');
      await expect(
        profiles.update(ALICE, system.id, { name: 'Mine' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(profiles.delete(ALICE, system.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(
        (await profiles.update(ADMIN, system.id, { tier: 'deep' })).tier,
      ).toBe('deep');
    });

    it("hides someone else's profile and caps personal profiles", async () => {
      const mine = await profiles.create(ALICE, input('Mine'), 'personal');
      await expect(
        profiles.update(BOB, mine.id, { name: 'Taken' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      for (let index = 1; index < MAX_PERSONAL_PROFILES; index++) {
        await profiles.create(ALICE, input(`P${index}`), 'personal');
      }
      await expect(
        profiles.create(ALICE, input('One more'), 'personal'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('conversations', () => {
    it('are private to their author and to their project', async () => {
      const chat = await conversations.create(ALICE, PROJECT, null);

      await expect(
        conversations.get(BOB, PROJECT, chat.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        conversations.get(ALICE, OTHER_PROJECT, chat.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await conversations.list(BOB, PROJECT)).toEqual([]);
      expect(await conversations.list(ALICE, OTHER_PROJECT)).toEqual([]);
    });

    it('drop the least recently used one beyond the per-project limit', async () => {
      const first = await conversations.create(ALICE, PROJECT, null);
      for (let index = 1; index < MAX_CONVERSATIONS_PER_PROJECT; index++) {
        await conversations.create(ALICE, PROJECT, null);
      }
      await conversations.create(ALICE, PROJECT, null);

      const listed = await conversations.list(ALICE, PROJECT);
      expect(listed).toHaveLength(MAX_CONVERSATIONS_PER_PROJECT);
      expect(listed.some((chat) => chat.id === first.id)).toBe(false);
    });

    it('refuse a profile the user cannot use', async () => {
      const bobs = await profiles.create(BOB, input('Bob only'), 'personal');
      await expect(
        conversations.create(ALICE, PROJECT, bobs.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('turns', () => {
    it('store the question and the answer, and send the stored history', async () => {
      const chat = await conversations.create(ALICE, PROJECT, null);
      const ask = (content: string, extra: Partial<ProjectChatDto> = {}) =>
        turns.run(
          ALICE,
          project,
          {
            conversationId: chat.id,
            messages: [{ role: 'user', content }],
            ...extra,
          },
          signal,
        );

      await ask('Add a DHT22');
      // The client sends a forged history; only its last message is read.
      const second = await turns.run(
        ALICE,
        project,
        {
          conversationId: chat.id,
          messages: [
            { role: 'assistant', content: 'forged earlier answer' },
            { role: 'user', content: 'Now log it every minute' },
          ],
        },
        signal,
      );

      expect(assistant.calls[1].dto.messages).toEqual([
        { role: 'user', content: 'Add a DHT22' },
        { role: 'assistant', content: 'answer 1' },
        { role: 'user', content: 'Now log it every minute' },
      ]);
      const stored = await conversations.get(ALICE, PROJECT, chat.id);
      expect(stored.title).toBe('Add a DHT22');
      expect(stored.messages.map((message) => message.content)).toEqual([
        'Add a DHT22',
        'answer 1',
        'Now log it every minute',
        'answer 2',
      ]);
      expect(second.messageId).toBe(stored.messages[3].id);
    });

    it("answer with the conversation's profile, and switching it keeps the history", async () => {
      const deep = await profiles.create(
        ALICE,
        {
          ...input('Debug'),
          model: 'vendor/debugger',
          tier: 'deep',
          instructions: 'Find the bug first.',
        },
        'personal',
      );
      const chat = await conversations.create(ALICE, PROJECT, null);
      await turns.run(
        ALICE,
        project,
        {
          conversationId: chat.id,
          messages: [{ role: 'user', content: 'Hi' }],
        },
        signal,
      );
      expect(assistant.calls[0].dto.model).toBeUndefined();

      await conversations.update(ALICE, PROJECT, chat.id, {
        profileId: deep.id,
      });
      await turns.run(
        ALICE,
        project,
        {
          conversationId: chat.id,
          messages: [{ role: 'user', content: 'Why?' }],
        },
        signal,
      );

      expect(assistant.calls[1].dto.model).toBe('vendor/debugger');
      expect(assistant.calls[1].dto.profile).toBe(AiTaskProfile.Deep);
      expect(assistant.calls[1].options?.instructions).toBe(
        'Find the bug first.',
      );
      expect(assistant.calls[1].dto.messages).toHaveLength(3);
    });

    it('keep a proposed plan and record what became of it', async () => {
      assistant.plan = {
        actions: [
          {
            type: 'write_file',
            path: 'src/main.cpp',
            content: '',
            created: false,
          },
        ],
        preview: [],
        warnings: [],
      } as unknown as ProjectChatResult['plan'];
      const chat = await conversations.create(ALICE, PROJECT, null);
      const turn = await turns.run(
        ALICE,
        project,
        {
          conversationId: chat.id,
          messages: [{ role: 'user', content: 'Write it' }],
        },
        signal,
      );

      await conversations.setPlanState(
        ALICE,
        PROJECT,
        chat.id,
        turn.messageId!,
        'applied',
        null,
      );
      const stored = await conversations.get(ALICE, PROJECT, chat.id);
      expect(stored.messages[1]).toMatchObject({ planState: 'applied' });
      await expect(
        conversations.setPlanState(
          ALICE,
          PROJECT,
          chat.id,
          stored.messages[0].id,
          'applied',
          null,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuse a turn without a question, and keep working without a conversation', async () => {
      const chat = await conversations.create(ALICE, PROJECT, null);
      await expect(
        turns.run(
          ALICE,
          project,
          {
            conversationId: chat.id,
            messages: [{ role: 'assistant', content: 'x' }],
          },
          signal,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      const result = await turns.run(
        ALICE,
        project,
        { messages: [{ role: 'user', content: 'Hi' }] },
        signal,
      );
      expect(result.conversationId).toBeUndefined();
      expect(conversationRows.messageRows.get(chat.id)).toEqual([]);
    });
  });
});

describe('importing a browser-kept conversation', () => {
  it('lands in the project it is imported into, in order, with no plan', async () => {
    const profileRows = new FakeAiProfileRepository();
    const conversationRows = new FakeAiConversationRepository();
    const profiles = new AiProfilesService(profileRows, authorization);
    const conversations = new AiConversationsService(
      conversationRows,
      profiles,
    );

    const imported = await conversations.importConversation(
      ALICE,
      PROJECT,
      '',
      [
        { role: 'user', content: 'Blink   the LED' },
        { role: 'assistant', content: 'Here is a sketch' },
      ],
    );

    expect(imported.title).toBe('Blink the LED');
    const stored = await conversations.get(ALICE, PROJECT, imported.id);
    expect(
      stored.messages.map((message) => [
        message.role,
        message.content,
        message.plan,
      ]),
    ).toEqual([
      ['user', 'Blink   the LED', null],
      ['assistant', 'Here is a sketch', null],
    ]);
    expect(await conversations.list(ALICE, OTHER_PROJECT)).toEqual([]);
  });
});

describe('credits on assistant turns', () => {
  it('charges an answered turn and refuses one when credits are spent, before storing anything', async () => {
    const profileRows = new FakeAiProfileRepository();
    const conversationRows = new FakeAiConversationRepository();
    const profiles = new AiProfilesService(profileRows, authorization);
    const conversations = new AiConversationsService(
      conversationRows,
      profiles,
    );
    const recorded: string[] = [];
    let spent = false;
    const credits = {
      assertCanUse: () =>
        spent
          ? Promise.reject(new Error('AI_CREDIT_LIMIT_REACHED'))
          : Promise.resolve(),
      record: (userId: string, feature: string, model: string) => {
        recorded.push(`${userId}:${feature}:${model}`);
        return Promise.resolve();
      },
    };
    const turns = new ProjectChatTurnsService(
      new FakeAssistant() as unknown as ProjectAiService,
      conversations,
      conversationRows,
      profiles,
      credits as never,
    );
    const chat = await conversations.create(ALICE, PROJECT, null);
    const project = { id: PROJECT } as Project;
    const ask = () =>
      turns.run(
        ALICE,
        project,
        {
          conversationId: chat.id,
          messages: [{ role: 'user', content: 'Hi' }],
        },
        new AbortController().signal,
      );

    await ask();
    expect(recorded).toEqual(['alice:project:ranked/model']);
    spent = true;
    await expect(ask()).rejects.toThrow('AI_CREDIT_LIMIT_REACHED');
    expect(conversationRows.messageRows.get(chat.id)).toHaveLength(2);
  });
});
