-- A project's updated_at represents the latest persisted change anywhere in the
-- project, not only a direct edit to the projects row. Project files, components,
-- and connections are stored separately, so their writes must touch the parent.

CREATE OR REPLACE FUNCTION public.touch_project_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.projects
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = OLD.project_id;

    RETURN OLD;
  END IF;

  UPDATE public.projects
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.project_id;

  -- Keep both projects accurate if a row is ever moved between projects outside
  -- Prisma, even though the current application does not expose that operation.
  IF TG_OP = 'UPDATE' AND OLD.project_id IS DISTINCT FROM NEW.project_id THEN
    UPDATE public.projects
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = OLD.project_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "project_files_touch_project_activity"
AFTER INSERT OR UPDATE OR DELETE ON public.project_files
FOR EACH ROW EXECUTE FUNCTION public.touch_project_activity();

CREATE TRIGGER "project_components_touch_project_activity"
AFTER INSERT OR UPDATE OR DELETE ON public.project_components
FOR EACH ROW EXECUTE FUNCTION public.touch_project_activity();

CREATE TRIGGER "project_connections_touch_project_activity"
AFTER INSERT OR UPDATE OR DELETE ON public.project_connections
FOR EACH ROW EXECUTE FUNCTION public.touch_project_activity();

-- Repair existing rows so the project list becomes correct as soon as this
-- migration is deployed, without waiting for every project to be edited again.
WITH latest_project_activity AS (
  SELECT project_id, MAX(updated_at) AS updated_at
  FROM (
    SELECT project_id, updated_at FROM public.project_files
    UNION ALL
    SELECT project_id, updated_at FROM public.project_components
    UNION ALL
    SELECT project_id, updated_at FROM public.project_connections
  ) AS project_activity
  GROUP BY project_id
)
UPDATE public.projects AS project
SET updated_at = activity.updated_at
FROM latest_project_activity AS activity
WHERE project.id = activity.project_id
  AND project.updated_at < activity.updated_at;

-- Trigger functions are implementation details and must not appear as callable
-- RPCs on Supabase's public schema.
REVOKE ALL ON FUNCTION public.touch_project_activity() FROM PUBLIC, anon, authenticated;
