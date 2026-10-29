// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";

/** The person's picture (Google's), or the first letter of their email when there is none or it doesn't load. */
export function AccountAvatar(props: {
  email: string;
  avatarUrl?: string | null;
  /** Tailwind size and text classes: `size-11 text-lg`. */
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  if (props.avatarUrl && !failed)
    return (
      <img
        src={props.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        // The editor is cross-origin isolated (COEP require-corp): Google sends no CORP header, but allows CORS.
        crossOrigin="anonymous"
        className={`shrink-0 rounded-full object-cover ${props.className}`}
        onError={() => setFailed(true)}
      />
    );
  return (
    <div
      aria-hidden
      className={`font-display bg-primary text-primary-foreground grid shrink-0 place-items-center rounded-full font-bold uppercase ${props.className}`}
    >
      {props.email.charAt(0)}
    </div>
  );
}
