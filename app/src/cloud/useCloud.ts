// SPDX-License-Identifier: AGPL-3.0-or-later
// The editor's view of cloud mode: null in local mode (no config.json), undefined while the
// config is loading. The backend code loads on first use, or at start when this browser has a
// session from an earlier visit.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CloudUser, ProjectSummary } from './backend';
import { type CloudConfig, hasSession, loadConfig, returningFromSignIn } from './config';
import type { SupabaseBackend } from './supabase';

export interface Cloud {
  config: CloudConfig;
  user: CloudUser | null;
  /** The person's cloud projects, newest first; null until listed. */
  projects: ProjectSummary[] | null;
  backend(): Promise<SupabaseBackend>;
  /** Lists the projects again (after a save, a delete, a sign-in). */
  refresh(): void;
}

export function useCloud(): Cloud | null | undefined {
  const [config, setConfig] = useState<CloudConfig | null | undefined>(undefined);
  const [user, setUser] = useState<CloudUser | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const connecting = useRef<Promise<SupabaseBackend> | null>(null);

  useEffect(() => {
    void loadConfig().then(setConfig);
  }, []);

  const backend = useCallback(() => {
    if (!config) return Promise.reject(new Error('no cloud backend is configured'));
    connecting.current ??= import('./supabase')
      .then((m) => m.SupabaseBackend.connect(config))
      .then((b) => {
        b.onUser(setUser);
        setUser(b.user());
        return b;
      })
      .catch((e: unknown) => {
        connecting.current = null;
        throw e;
      });
    return connecting.current;
  }, [config]);

  const refresh = useCallback(() => {
    const c = connecting.current;
    if (!c) return;
    void c.then((b) => b.listProjects()).then(setProjects, () => setProjects(null));
  }, []);

  useEffect(() => {
    if (config && (hasSession() || returningFromSignIn())) void backend().catch(() => undefined);
  }, [config, backend]);

  // Someone else signed in: their own list.
  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  const shown = user ? projects : null;
  return useMemo(() => (config ? { config, user, projects: shown, backend, refresh } : config), [config, user, shown, backend, refresh]);
}
