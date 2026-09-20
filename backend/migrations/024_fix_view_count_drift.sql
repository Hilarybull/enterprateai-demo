-- Fixes a real inconsistency: proposal_requests.view_count was an
-- independently-incremented counter, while the "who viewed" list reads from
-- proposal_request_views. A couple of views recorded by the earlier version
-- of record_proposal_request_view() (before the dedup table existed) bumped
-- the counter without ever writing a viewer-log row, so a request could show
-- "2 views" with an empty "who viewed" list — not a display bug, an actual
-- data mismatch between the two.
--
-- Fix: view_count is no longer incremented independently. It's now always
-- resynced to COUNT(*) of the real viewer-log rows, so it can never disagree
-- with the list again. Also backfills every existing request's count to the
-- true number right now (this may lower some counts — that's intentional:
-- a number with no viewer behind it wasn't a real view).

CREATE OR REPLACE FUNCTION record_proposal_request_view(p_request_id UUID, p_viewer_key TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO proposal_request_views (request_id, viewer_key)
  VALUES (p_request_id, p_viewer_key)
  ON CONFLICT (request_id, viewer_key) DO NOTHING;

  UPDATE proposal_requests
  SET view_count = (
    SELECT COUNT(*) FROM proposal_request_views WHERE request_id = p_request_id
  )
  WHERE id = p_request_id
  RETURNING view_count INTO new_count;

  RETURN new_count;
END;
$$;

-- One-time backfill: make every existing request's count match reality now.
UPDATE proposal_requests r
SET view_count = (
  SELECT COUNT(*) FROM proposal_request_views v WHERE v.request_id = r.id
);
