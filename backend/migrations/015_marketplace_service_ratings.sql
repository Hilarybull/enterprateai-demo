-- 015: Per-service ratings for marketplace
-- Adds service_name column so ratings can be scoped to an individual product/service.
-- Empty string '' = company-level rating (existing behaviour).

alter table marketplace_ratings
  add column if not exists service_name text not null default '';

-- Drop old unique constraints (they don't include service_name)
alter table marketplace_ratings
  drop constraint if exists marketplace_ratings_ws_email_unique;

alter table marketplace_ratings
  drop constraint if exists marketplace_ratings_workspace_id_user_id_key;

-- New composite unique indexes that include service_name
create unique index if not exists marketplace_ratings_ws_email_service_idx
  on marketplace_ratings(workspace_id, lower(coalesce(rater_email, '')), service_name);

create unique index if not exists marketplace_ratings_ws_user_service_idx
  on marketplace_ratings(workspace_id, user_id, service_name)
  where user_id is not null;
