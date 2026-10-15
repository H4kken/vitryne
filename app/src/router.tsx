// SPDX-License-Identifier: AGPL-3.0-or-later
// The editor's URLs: `/` (the start screen, or a project not in the cloud yet) and
// `/design/$id` (a cloud project). The editor stays mounted across them (the 3D engine lives in
// it): the routes render nothing, and `editor/useProjectRoute.ts` keeps the URL and the open
// project in step. Any other path goes to `/`.

import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { App } from './App';

const rootRoute = createRootRoute({ component: App });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/' });

export const designRoute = createRoute({ getParentRoute: () => rootRoute, path: '/design/$id' });

const elseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$',
  beforeLoad: () => {
    throw redirect({ to: '/', replace: true });
  },
});

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, designRoute, elseRoute]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
