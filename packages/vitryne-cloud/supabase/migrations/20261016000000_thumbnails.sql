-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Project thumbnails (docs/CLOUD.md, Projects): a small image of the drape, shown on the start
-- screen's project cards. The image is a part like any other (<owner>/<sha256> in the `parts`
-- bucket, so the quota counts it and the same policies guard it); the row names its hash. It is
-- not in the project's manifest: it follows the drape, not the document, so changing it is not
-- an edit (no new revision, `updated_at` kept) and an exported .vtry doesn't carry it.

alter table public.projects
  add column thumbnail text check (thumbnail is null or thumbnail ~ '^[0-9a-f]{64}$');
grant update (thumbnail) on public.projects to authenticated;

-- As in 20261015000000_anonymous_drafts.sql, plus: an update that changes only the thumbnail
-- keeps the revision and the clock (a save in progress elsewhere still matches its revision).
create or replace function vitryne_private.project_rules() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  n bigint;
begin
  if tg_op = 'INSERT' then
    if new.owner = (select auth.uid()) then
      select count(*) into n from public.projects p where p.owner = new.owner;
      if (select u.is_anonymous from auth.users u where u.id = new.owner)
         and n >= (select l.max_anonymous_projects from vitryne_private.limits l) then
        raise exception 'an account is needed to keep more projects' using errcode = 'P0001', hint = 'account';
      end if;
      if n >= (select l.max_projects from vitryne_private.limits l) then
        raise exception 'project limit reached' using errcode = 'P0001', hint = 'quota';
      end if;
    end if;
    new.created_at := now();
    new.revision := 1;
    new.updated_at := now();
    return new;
  end if;
  new.id := old.id;
  new.owner := old.owner;
  new.created_at := old.created_at;
  if (new.name, new.manifest, new.bytes) is not distinct from (old.name, old.manifest, old.bytes) then
    new.revision := old.revision;
    new.updated_at := old.updated_at;
  else
    new.revision := old.revision + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;

-- As in 20261014000000_cloud_storage.sql, plus: a part a project names as its thumbnail is used.
create or replace function public.my_unused_parts() returns setof text
  language sql stable security invoker set search_path = '' as $$
  select o.name from storage.objects o
  where o.bucket_id = 'parts'
    and o.name like auth.uid()::text || '/%'
    and o.created_at < now() - interval '1 day'
    and not exists (
      select 1 from public.projects p, jsonb_array_elements(p.manifest -> 'parts') part
      where p.owner = auth.uid() and auth.uid()::text || '/' || (part ->> 'sha256') = o.name
    )
    and not exists (
      select 1 from public.projects p
      where p.owner = auth.uid() and auth.uid()::text || '/' || p.thumbnail = o.name
    )
$$;
