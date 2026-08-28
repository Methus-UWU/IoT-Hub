-- Make account deletion possible without destroying other people's work.
--
-- Problem found by testing the previous migration: `users.id` cascades from
-- `auth.users`, but `workspaces.owner_id` is ON DELETE RESTRICT, so deleting an
-- account failed outright — from the API, from the Supabase admin API, and from the
-- dashboard. Every user owns at least one workspace, because the sign-up trigger
-- creates a personal one, so this affected every account.
--
-- Cascading workspaces instead would have been worse: a shared workspace would
-- vanish with its owner, taking every other member's work with it.
--
-- This trigger runs before the profile row is removed and settles ownership first:
--
--   * workspace has other members -> hand it to the most senior of them
--   * workspace has no other members -> delete it
--
-- The RESTRICT constraint stays as a safety net. It should now never fire; if it
-- ever does, it means this trigger failed to cover a case, and refusing the delete
-- is the right outcome.

CREATE OR REPLACE FUNCTION public.handle_user_workspace_succession()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owned RECORD;
  successor_id UUID;
BEGIN
  FOR owned IN
    SELECT id FROM workspaces WHERE owner_id = OLD.id
  LOOP
    -- Most senior remaining member: highest workspace role, then longest standing.
    SELECT m.user_id INTO successor_id
    FROM workspace_members m
    WHERE m.workspace_id = owned.id
      AND m.user_id <> OLD.id
    ORDER BY public.workspace_role_rank(m.role) DESC, m.created_at ASC
    LIMIT 1;

    IF successor_id IS NULL THEN
      DELETE FROM workspaces WHERE id = owned.id;
    ELSE
      UPDATE workspaces
      SET owner_id = successor_id, updated_at = now()
      WHERE id = owned.id;

      UPDATE workspace_members
      SET role = 'owner', updated_at = now()
      WHERE workspace_id = owned.id AND user_id = successor_id;
    END IF;
  END LOOP;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_user_deleted_transfer_workspaces ON public.users;

CREATE TRIGGER on_user_deleted_transfer_workspaces
  BEFORE DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_workspace_succession();
