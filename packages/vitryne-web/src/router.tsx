// SPDX-License-Identifier: AGPL-3.0-or-later
// The editor's URLs, each with its own screen (src/routes/): `/` the start screen,
// `/design/$id` a cloud project, `/example/$name` a bundled example not changed yet, `/new` a
// project before its first save. The editor layout (`App` → `Editor`) stays mounted across
// them, because the 3D engine lives in it; the routes render into its outlet. Any other path goes
// to `/`.

import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { App } from "./App";
import { DesignRoute } from "./routes/DesignRoute";
import { ExampleRoute } from "./routes/ExampleRoute";
import { HomeRoute } from "./routes/HomeRoute";
import { NewRoute } from "./routes/NewRoute";

const rootRoute = createRootRoute({ component: App });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeRoute,
});

const newRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/new",
  component: NewRoute,
});

const designRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/design/$id",
  component: DesignRoute,
});

const exampleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/example/$name",
  component: ExampleRoute,
});

const elseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    newRoute,
    designRoute,
    exampleRoute,
    elseRoute,
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
