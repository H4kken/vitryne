// SPDX-License-Identifier: AGPL-3.0-or-later
// GitHub's mark (public/images/github.svg), drawn in the text colour: the file has no fill of its
// own, so a mask takes its shape.

export function GithubIcon() {
  const url = `url(${import.meta.env.BASE_URL}images/github.svg)`;
  return (
    <span
      aria-hidden
      className="inline-block size-4 shrink-0 bg-current"
      style={{
        mask: `${url} center / contain no-repeat`,
        WebkitMask: `${url} center / contain no-repeat`,
      }}
    />
  );
}
