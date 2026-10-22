const PUBLIC_COMMUNITY_PATH = '/community';
const USER_COMMUNITY_PATH = '/user/community';

/** Keeps community links inside the current public, user, or project context. */
export function communityBasePath(url: string): string {
  const projectPath = url.match(/^\/user\/projects\/[^/?#]+\/community(?=[/?#]|$)/)?.[0];
  if (projectPath) return projectPath;
  return url.startsWith(USER_COMMUNITY_PATH) ? USER_COMMUNITY_PATH : PUBLIC_COMMUNITY_PATH;
}
