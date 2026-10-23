-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The local database's first start (docker-compose.yml), after the image's own setup: the
-- services' passwords and the JWT secret, as the Supabase CLI sets them, and the cleanup
-- function's address and secret in Vault (migrations/…_anonymous_drafts.sql reads them).
\set pgpass `echo "$PGPASSWORD"`
\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "$JWT_EXP"`

alter database postgres set "app.settings.jwt_secret" to :'jwt_secret';
alter database postgres set "app.settings.jwt_exp" to :'jwt_exp';

alter user postgres with password :'pgpass';
alter user authenticator with password :'pgpass';
alter user pgbouncer with password :'pgpass';
alter user supabase_auth_admin with password :'pgpass';
alter user supabase_storage_admin with password :'pgpass';

select vault.create_secret('http://gateway:8000/functions/v1', 'vitryne_functions_url');
select vault.create_secret('local-cleanup-secret', 'vitryne_cleanup_secret');
