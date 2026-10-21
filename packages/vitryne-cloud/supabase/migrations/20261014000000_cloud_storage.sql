-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Cloud storage (docs/FORMAT.md, "Cloud storage"; docs/CLOUD.md): a project is a row holding its
-- manifest, and its parts are objects named <owner>/<sha256> in the private `parts` bucket. Every
-- table and the bucket are behind row-level security: a person reaches only their own rows and
-- objects. Applied by the Supabase CLI (`supabase db push` to a hosted project, `supabase start`
-- locally), or by the web image at start when SUPABASE_DB_URL is set (packages/vitryne-cloud/deploy/web/entrypoint.sh).

-- Settings the operator controls (change them with SQL, docs/CLOUD.md) and the helpers the
-- policies call. Nothing in this schema is reachable through the REST API.
create schema vitryne_private;
revoke all on schema vitryne_private from public;
grant usage on schema vitryne_private to authenticated;

create table vitryne_private.limits (
  id boolean primary key default true check (id),
  -- Bytes of parts one person may store; a new part is refused once this is reached.
  quota_bytes bigint not null,
  max_projects integer not null
);
insert into vitryne_private.limits values (true, 1073741824, 500);
revoke all on vitryne_private.limits from public, anon, authenticated;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  -- The file's manifest.json: every part with its path, media type and sha256.
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object' and octet_length(manifest::text) <= 1048576),
  -- Sum of the parts' sizes, as the client measured them (for the list; quotas count objects).
  bytes bigint not null check (bytes >= 0),
  -- Bumped by every update: a save names the revision it started from, so two tabs saving the
  -- same project can't silently overwrite each other.
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner_updated on public.projects (owner, updated_at desc);

alter table public.projects enable row level security;
revoke all on public.projects from public, anon, authenticated;
grant select, insert, delete on public.projects to authenticated;
grant update (name, manifest, bytes) on public.projects to authenticated;

create policy "own projects: read" on public.projects for select to authenticated
  using (owner = (select auth.uid()));
create policy "own projects: add" on public.projects for insert to authenticated
  with check (owner = (select auth.uid()));
create policy "own projects: change" on public.projects for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "own projects: delete" on public.projects for delete to authenticated
  using (owner = (select auth.uid()));

-- Server-kept columns: the owner and id never change, the clock and revision are the server's,
-- and the project count is capped.
create function vitryne_private.project_rules() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.projects p where p.owner = new.owner)
       >= (select l.max_projects from vitryne_private.limits l) then
      raise exception 'project limit reached' using errcode = 'P0001', hint = 'quota';
    end if;
    new.created_at := now();
    new.revision := 1;
  else
    new.id := old.id;
    new.owner := old.owner;
    new.created_at := old.created_at;
    new.revision := old.revision + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function vitryne_private.project_rules() from public;
create trigger project_rules before insert or update on public.projects
  for each row execute function vitryne_private.project_rules();

-- Parts. The bucket is private; objects are only reached through the policies below.
-- 50 MB per part: the most a hosted project on the free plan accepts per file.
insert into storage.buckets (id, name, public, file_size_limit)
  values ('parts', 'parts', false, 52428800);

create function vitryne_private.used_bytes(uid uuid) returns bigint
  language sql stable security definer set search_path = '' as $$
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
  from storage.objects o
  where o.bucket_id = 'parts' and o.name like uid::text || '/%'
$$;
revoke all on function vitryne_private.used_bytes(uuid) from public;

-- True while the person is under their quota. Checked before each new part, so the overshoot is
-- at most one part (the bucket's size limit).
create function vitryne_private.may_store() returns boolean
  language sql stable security definer set search_path = '' as $$
  select vitryne_private.used_bytes(auth.uid()) < (select l.quota_bytes from vitryne_private.limits l)
$$;
revoke all on function vitryne_private.may_store() from public;
grant execute on function vitryne_private.may_store() to authenticated;

-- A part's name is <owner id>/<sha256 in hex>, nothing else. Parts are never overwritten (no
-- update policy): the same name always means the same bytes.
create policy "own parts: read" on storage.objects for select to authenticated
  using (bucket_id = 'parts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own parts: add" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'parts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}$'
    and (select vitryne_private.may_store())
  );
create policy "own parts: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'parts' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- What the account page shows: bytes stored and the quota.
create function public.my_usage() returns table (used_bytes bigint, quota_bytes bigint, projects bigint, max_projects integer)
  language sql stable security definer set search_path = '' as $$
  select vitryne_private.used_bytes(auth.uid()),
         l.quota_bytes,
         (select count(*) from public.projects p where p.owner = auth.uid()),
         l.max_projects
  from vitryne_private.limits l
  where auth.uid() is not null
$$;
revoke all on function public.my_usage() from public, anon;
grant execute on function public.my_usage() to authenticated;

-- The person's parts no project of theirs uses any more, older than a day (a save in another
-- tab may have uploaded parts whose manifest isn't written yet). The client deletes them.
create function public.my_unused_parts() returns setof text
  language sql stable security invoker set search_path = '' as $$
  select o.name from storage.objects o
  where o.bucket_id = 'parts'
    and o.name like auth.uid()::text || '/%'
    and o.created_at < now() - interval '1 day'
    and not exists (
      select 1 from public.projects p, jsonb_array_elements(p.manifest -> 'parts') part
      where p.owner = auth.uid() and auth.uid()::text || '/' || (part ->> 'sha256') = o.name
    )
$$;
revoke all on function public.my_unused_parts() from public, anon;
grant execute on function public.my_unused_parts() to authenticated;

-- Account deletion (GDPR art. 17). The client first deletes its parts through the storage API
-- (which removes the files, not only their rows), then calls this: the projects go with the
-- user (on delete cascade), and so do the sessions and identities Auth keeps.
create function public.delete_my_account() returns void
  language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'parts' and o.name like uid::text || '/%') then
    raise exception 'delete the stored parts first' using errcode = 'P0001', hint = 'parts';
  end if;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
