# IoT Advisor

The shared advisor page serves both `/user/assistant` and
`/user/projects/:projectId/assistant`.

The compact AI ADVISOR header and mode buttons sit above a bordered conversation.
User messages appear in dark, right-aligned bubbles; assistant replies use the
shared Markdown renderer. The conversation scrolls independently of the composer.

Both advice and error analysis start from the bottom composer. Users paste Arduino
IDE or PlatformIO errors directly, with board details and relevant code in the
same message. The previous dedicated error-report form and its page-local model
were intentionally replaced as part of restoring the chat layout. Their references
were confined to this component and template; no API or route was removed.

Requests still use `POST /api/ai/advisor/chat` with the selected mode and up to
30 recent messages. Blank messages are rejected, messages are limited to 12,000
characters, and duplicate sends are blocked while a reply is pending.
Enter sends; Shift+Enter inserts a newline. Switching modes or starting over
clears the local conversation. Reloading does not restore it.

Verification: frontend production build and `e2e/iot-advisor.spec.ts`, covering
desktop/project and mobile/global routes with mocked API responses, error-mode
submission, follow-up context, advice mode, reset, keyboard behavior, request
failure, and composer visibility.
