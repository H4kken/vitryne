// SPDX-License-Identifier: AGPL-3.0-or-later
// Deletes anonymous users nobody came back to (packages/vitryne-cloud/supabase/migrations/…_anonymous_drafts.sql,
// docs/CLOUD.md): their parts through the Storage API (SQL can't remove the files), then the user,
// which takes their draft with it. Called once a day by pg_cron with the `x-cleanup-secret`
// header; anything else is refused. A user whose parts fail to go is kept for the next run.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const BUCKET = 'parts';

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CLEANUP_SECRET');
  if (req.method !== 'POST' || !secret || !same(req.headers.get('x-cleanup-secret') ?? '', secret)) {
    return new Response('forbidden', { status: 403 });
  }
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: ids, error } = await sb.rpc('stale_anonymous_users');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let removed = 0;
  const failed: string[] = [];
  for (const id of ids as string[]) {
    try {
      for (;;) {
        const { data: objects, error: e } = await sb.storage.from(BUCKET).list(id, { limit: 1000 });
        if (e) throw e;
        if (!objects.length) break;
        const { error: r } = await sb.storage.from(BUCKET).remove(objects.map((o) => `${id}/${o.name}`));
        if (r) throw r;
      }
      const { error: d } = await sb.auth.admin.deleteUser(id);
      if (d) throw d;
      removed++;
    } catch {
      failed.push(id);
    }
  }
  return Response.json({ removed, failed });
});
