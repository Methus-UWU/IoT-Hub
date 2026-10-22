import { BadRequestException, Injectable, Optional } from '@nestjs/common';

import { AiCreditsService } from '../../ai-credits/ai-credits.service';

import type { Project } from '../../projects/project.repository';
import { AiTaskProfile } from '../dto/ai-chat.dto';
import type { AiProgressListener } from '../project/ai-progress';
import type { ProjectChatDto } from '../project/dto/project-ai.dto';
import {
  ProjectAiService,
  type ProjectChatResult,
} from '../project/project-ai.service';
import {
  AiConversationRepository,
  AiProfileRecord,
} from './ai-conversation.repository';
import { AiConversationsService } from './ai-conversations.service';
import { AiProfilesService } from './ai-profiles.service';

/** Turns of stored history sent with a new question; older ones are summarised away. */
const HISTORY_TURNS = 29;
const MAX_STORED_CONTENT = 50_000;
/** A plan above this is answered but not kept: the row has a 2 MB ceiling. */
const MAX_STORED_PLAN_CHARS = 1_500_000;
const TITLE_LENGTH = 60;

export interface ProjectChatTurn extends ProjectChatResult {
  /** Present when the turn was saved to a conversation. */
  conversationId?: string;
  messageId?: string;
  userMessageId?: string;
  /** The profile the turn was answered with. */
  profileId?: string | null;
}

/**
 * One assistant turn with its profile and its history.
 *
 * With a `conversationId`, the server is the record of what was said: the history
 * comes from the database, not from the request, and both the question and the answer
 * are stored. Only the newest user message of the request is read. Without one, the
 * turn runs as before on the messages the client sent, so older clients keep working.
 *
 * A profile sets the model, the reasoning tier, and extra instructions. A conversation
 * uses its own profile; a request may name one only when it has no conversation.
 */
@Injectable()
export class ProjectChatTurnsService {
  constructor(
    private readonly assistant: ProjectAiService,
    private readonly conversations: AiConversationsService,
    private readonly store: AiConversationRepository,
    private readonly profiles: AiProfilesService,
    @Optional() private readonly credits?: AiCreditsService,
  ) {}

  async run(
    userId: string,
    project: Project,
    dto: ProjectChatDto,
    signal: AbortSignal,
    onProgress?: AiProgressListener,
  ): Promise<ProjectChatTurn> {
    // Refused before anything is stored or sent, so a spent allowance costs nothing.
    await this.credits?.assertCanUse(userId);
    const turn = await this.answer(userId, project, dto, signal, onProgress);
    await this.credits?.record(userId, 'project', turn.model, turn.usage);
    return turn;
  }

  private async answer(
    userId: string,
    project: Project,
    dto: ProjectChatDto,
    signal: AbortSignal,
    onProgress?: AiProgressListener,
  ): Promise<ProjectChatTurn> {
    if (!dto.conversationId) {
      const profile = dto.profileId
        ? await this.profiles.requireUsable(userId, dto.profileId)
        : null;
      const result = await this.assistant.chat(
        project,
        applyProfile(dto, profile),
        signal,
        onProgress,
        { instructions: profile?.instructions },
      );
      return { ...result, profileId: profile?.id ?? null };
    }

    const conversation = await this.conversations.requireOwned(
      userId,
      project.id,
      dto.conversationId,
    );
    const question = dto.messages.at(-1);
    if (!question || question.role !== 'user' || !question.content.trim()) {
      throw new BadRequestException({
        code: 'AI_MESSAGE_REQUIRED',
        message: 'The last message must be the user question',
      });
    }
    const profile = conversation.profileId
      ? await this.profiles
          .requireUsable(userId, conversation.profileId)
          .catch(() => null)
      : null;

    const history = await this.store.messages(conversation.id, HISTORY_TURNS);
    const asked = await this.store.appendMessage(
      conversation.id,
      {
        role: 'user',
        content: question.content,
        plan: null,
        planState: null,
        planError: null,
        model: null,
      },
      question.content.trim().replace(/\s+/g, ' ').slice(0, TITLE_LENGTH),
    );

    const result = await this.assistant.chat(
      project,
      applyProfile(
        {
          ...dto,
          messages: [
            ...history.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            { role: 'user', content: question.content },
          ],
        },
        profile,
      ),
      signal,
      onProgress,
      { instructions: profile?.instructions },
    );

    const plan = result.plan?.actions.length ? result.plan : null;
    const keepPlan =
      plan !== null && JSON.stringify(plan).length <= MAX_STORED_PLAN_CHARS;
    const answered = await this.store.appendMessage(conversation.id, {
      role: 'assistant',
      content: result.content.slice(0, MAX_STORED_CONTENT),
      plan: keepPlan ? plan : null,
      planState: keepPlan ? 'pending' : null,
      planError: null,
      model: result.model,
    });

    return {
      ...result,
      conversationId: conversation.id,
      userMessageId: asked.id,
      messageId: answered.id,
      profileId: profile?.id ?? null,
    };
  }
}

const TIER_TO_TASK: Record<AiProfileRecord['tier'], AiTaskProfile> = {
  auto: AiTaskProfile.Auto,
  balanced: AiTaskProfile.Balanced,
  deep: AiTaskProfile.Deep,
};

/** The profile's model and tier replace what the request asked for. */
function applyProfile(
  dto: ProjectChatDto,
  profile: AiProfileRecord | null,
): ProjectChatDto {
  if (!profile) return dto;
  return {
    ...dto,
    model: profile.model ?? undefined,
    profile: TIER_TO_TASK[profile.tier],
  };
}
