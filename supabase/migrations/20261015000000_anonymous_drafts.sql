-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Anonymous drafts (docs/CLOUD.md, Accounts): anyone can try the editor without an account, and
-- their work is kept as one draft. Keeping more projects (and exporting) needs a free account. A
-- draft left alone for `anonymous_days` goes, with its user: the `clean-anonymous` Edge Function
-- deletes the parts through the Storage API (SQL can't remove the files), then the user, and
-- pg_cron calls it once a day.

alter table vitryne_private.limits
  -- Projects an anonymous user may keep (their draft).
  add column max_anonymous_projects integer not null default 1,
  -- Days without activity after which an anonymous user and their draft are deleted.
  add column anonymous_days integer not null default 30;

-- The owner's state decides, not the token's: an anonymous user who became an account (same id)
-- is one at once, and a draft moved into an account (moveProjects) counts against the account.
-- Only the caller's own rows are counted: a row for someone else is refused by row-level
-- security (this trigger runs first), and counting it would tell the caller about that user.
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
  else
    new.id := old.id;
    new.owner := old.owner;
    new.created_at := old.created_at;
    new.revision := old.revision + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- The project limit an anonymous user sees is their draft's.
create or replace function public.my_usage() returns table (used_bytes bigint, quota_bytes bigint, projects bigint, max_projects integer)
  language sql stable security definer set search_path = '' as $$
  select vitryne_private.used_bytes(auth.uid()),
         l.quota_bytes,
         (select count(*) from public.projects p where p.owner = auth.uid()),
         case when (select u.is_anonymous from auth.users u where u.id = auth.uid()) then l.max_anonymous_projects else l.max_projects end
  from vitryne_private.limits l
  where auth.uid() is not null
$$;

-- Anonymous users with no activity (sign-in, token refresh, project save) for `anonymous_days`,
-- oldest first, at most 500 per call. Only the cleanup function (service role) may call it.
create function public.stale_anonymous_users() returns setof uuid
  language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u
  where u.is_anonymous
    and greatest(
          u.created_at,
          u.updated_at,
          u.last_sign_in_at,
          (select max(greatest(s.updated_at, s.refreshed_at at time zone 'UTC')) from auth.sessions s where s.user_id = u.id),
          (select max(p.updated_at) from public.projects p where p.owner = u.id)
        ) < now() - make_interval(days => (select l.anonymous_days from vitryne_private.limits l))
  order by u.created_at
  limit 500
$$;
revoke all on function public.stale_anonymous_users() from public, anon, authenticated;
grant execute on function public.stale_anonymous_users() to service_role;

-- The daily call. The function's URL and its secret are kept in Vault by the operator
-- (docs/CLOUD.md); without them (the local stack, a new project) this does nothing.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create function vitryne_private.clean_anonymous() returns void
  language plpgsql security definer set search_path = '' as $$
declare
  url text := (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'vitryne_functions_url');
  secret text := (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'vitryne_cleanup_secret');
begin
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(url, '/') || '/clean-anonymous',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cleanup-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end $$;
revoke all on function vitryne_private.clean_anonymous() from public, anon, authenticated;

select cron.schedule('vitryne-clean-anonymous', '17 3 * * *', 'select vitryne_private.clean_anonymous()');
