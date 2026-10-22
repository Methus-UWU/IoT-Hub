-- Take the community trigger functions off the PostgREST surface.
--
-- Postgres grants EXECUTE on a new function to PUBLIC, and Supabase exposes
-- `public` through PostgREST, so these three were callable as
-- /rest/v1/rpc/<name> by anon and authenticated alike. They are SECURITY
-- DEFINER, which is what makes that worth closing even though a direct call
-- fails: a trigger function invoked outside a trigger raises rather than
-- running, so nothing was exploitable — but a definer-rights function should
-- never be reachable by an anonymous caller in the first place.
--
-- Triggers are unaffected: a trigger runs as the table owner and does not
-- consult EXECUTE grants.

REVOKE ALL ON FUNCTION public.community_apply_vote_delta() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_apply_comment_delta() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_apply_tag_delta() FROM PUBLIC, anon, authenticated;
