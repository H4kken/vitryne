-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Share links (packages/vitryne-docs/content/docs/developers/cloud.md, Sharing): an owner can make
-- a project viewable by anyone who has its link (its own address, /design/<project id>). Every project is private
-- until its owner turns that on, and off again at any time. The link is the project's id (a
-- random uuid), so it can't be guessed; nobody can list shared projects.
--
-- What a stranger can reach is two things, nothing more: `shared_project(id)`, which returns one
-- shared project's row, and the parts that project names (its manifest's parts and its thumbnail).
-- The `projects` table itself stays owner-only, so no policy lets one person's list show another's.
-- Opening a shared project is read-only by nature: there is no write path for anyone but the owner;
-- the editor opens it view only, and "Make a copy" saves a new project of the viewer's own.

alter table public.projects add column shared boolean not null default false;
grant update (shared) on public.projects to authenticated;

-- As in 20261016000000_thumbnails.sql, plus: a new project is private (a copy of a shared one
-- is not shared), only an account may share, and turning sharing on or off is not an edit (the
-- revision and the clock stay, so a save in another tab still matches).
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
    new.shared := false;
    return new;
  end if;
  new.id := old.id;
  new.owner := old.owner;
  new.created_at := old.created_at;
  if new.shared and not old.shared
     and (select u.is_anonymous from auth.users u where u.id = new.owner) then
    raise exception 'an account is needed to share a project' using errcode = 'P0001', hint = 'account';
  end if;
  if (new.name, new.manifest, new.bytes) is not distinct from (old.name, old.manifest, old.bytes) then
    new.revision := old.revision;
    new.updated_at := old.updated_at;
  else
    new.revision := old.revision + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;

-- One shared project, for anyone who knows its id (signed in or not). No row for a private or
-- missing project: the two look the same.
create function public.shared_project(pid uuid)
  returns table (id uuid, owner uuid, name text, manifest jsonb, bytes bigint, revision integer, updated_at timestamptz, thumbnail text)
  language sql stable security definer set search_path = '' as $$
  select p.id, p.owner, p.name, p.manifest, p.bytes, p.revision, p.updated_at, p.thumbnail
  from public.projects p
  where p.id = pid and p.shared
$$;
revoke all on function public.shared_project(uuid) from public;
grant execute on function public.shared_project(uuid) to anon, authenticated;

-- Whether `part` (<owner>/<sha256>) belongs to a shared project: named by its manifest or as its
-- thumbnail.
create function vitryne_private.is_shared_part(part text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    where p.shared
      and p.owner::text = split_part(part, '/', 1)
      and (
        p.thumbnail = split_part(part, '/', 2)
        or exists (
          select 1 from jsonb_array_elements(p.manifest -> 'parts') m
          where m ->> 'sha256' = split_part(part, '/', 2)
        )
      )
  )
$$;
revoke all on function vitryne_private.is_shared_part(text) from public;
grant usage on schema vitryne_private to anon;
grant execute on function vitryne_private.is_shared_part(text) to anon, authenticated;

create policy "shared parts: read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'parts' and vitryne_private.is_shared_part(name));
