// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The project id in a `/design/<id>` address (under the app's base path), or undefined for any
 * other page. A Google sign-in comes back to the start page, and this is what it reopens: the
 * page the person left, whether the project is theirs, shared with them, or one they can't open
 * yet (the error page's Sign in).
 */
export function designIdAt(pathname: string, base: string): string | undefined {
  if (!pathname.startsWith(base)) return undefined;
  return /^design\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(
    pathname.slice(base.length),
  )?.[1];
}
