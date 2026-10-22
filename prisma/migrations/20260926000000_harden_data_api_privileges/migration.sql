-- Harden the objects exposed through Supabase's Data API.
--
-- RLS chooses rows after Postgres grants have allowed an operation. Revoke the
-- broad defaults first, then grant only operations that have an explicit policy.

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- The Angular application writes through NestJS, where DTO validation and policy
-- checks run. Direct Data API access is read-only; granting whole-row UPDATE here
-- would let a user change sensitive columns such as users.role_id or a workspace's
-- owner_id even though the visible profile form only exposes a username.
-- Signed-in account and workspace data.
GRANT SELECT ON TABLE public.users TO authenticated;
GRANT SELECT ON TABLE public.roles TO authenticated;
GRANT SELECT ON TABLE public.workspaces TO authenticated;
GRANT SELECT ON TABLE public.workspace_members TO authenticated;

-- Project data. Row visibility and editor rights remain constrained by RLS.
GRANT SELECT ON TABLE public.projects TO authenticated;
GRANT SELECT ON TABLE public.project_files TO authenticated;
GRANT SELECT ON TABLE public.project_components TO authenticated;
GRANT SELECT ON TABLE public.project_connections TO authenticated;

-- Billing reference data is read-only from the client. Subscription changes go
-- through the authorized backend.
GRANT SELECT ON TABLE public.plans TO authenticated;
GRANT SELECT ON TABLE public.plan_limits TO authenticated;
GRANT SELECT ON TABLE public.user_subscriptions TO authenticated;

-- Public community reads and authenticated author operations.
GRANT SELECT ON TABLE public.community_tags TO anon, authenticated;
GRANT SELECT ON TABLE public.community_posts TO anon;
GRANT SELECT ON TABLE public.community_posts TO authenticated;
GRANT SELECT ON TABLE public.community_comments TO anon;
GRANT SELECT ON TABLE public.community_comments TO authenticated;
GRANT SELECT ON TABLE public.community_post_tags TO anon;
GRANT SELECT ON TABLE public.community_post_tags TO authenticated;
GRANT SELECT ON TABLE public.community_votes TO authenticated;

-- Functions are executable by PUBLIC unless revoked. Name application functions
-- explicitly so this migration cannot alter an extension function that a deployment
-- may also keep in public. Trigger implementations and sign-up maintenance are never
-- client RPCs; only the two RLS helpers need to run as an authenticated caller.
REVOKE ALL ON FUNCTION public.workspace_role_rank(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_workspace_access(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_project_access(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_auth_user_email_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_user_workspace_succession() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_apply_vote_delta() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_apply_comment_delta() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_apply_tag_delta() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_project_activity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_workspace_access(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_project_access(UUID, TEXT) TO authenticated;
