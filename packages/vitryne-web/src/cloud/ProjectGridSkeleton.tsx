// SPDX-License-Identifier: AGPL-3.0-or-later
// What the start screen shows where the project cards go while the list is being fetched: the same
// grid and card shapes as ProjectGrid, so nothing jumps when the projects arrive.

export function ProjectGridSkeleton(props: { title: string }) {
  return (
    <section
      aria-label={props.title}
      aria-busy="true"
      className="flex flex-col gap-3"
    >
      <h2 className="font-display m-0 text-[22px] font-semibold">
        {props.title}
      </h2>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 p-0">
        {[0, 1, 2, 3].map((i) => (
          <li
            key={i}
            aria-hidden="true"
            className="flex min-w-0 animate-pulse flex-col overflow-hidden rounded-2xl border border-border bg-card"
          >
            <div className="bg-muted aspect-[4/3] w-full" />
            <div className="flex flex-col gap-2 px-4 pt-3 pb-3.5">
              <div className="bg-muted h-4 w-2/3 rounded" />
              <div className="bg-muted h-3 w-1/3 rounded" />
            </div>
          </li>
        ))}
      </ul>
      <span className="sr-only" role="status">
        Loading your projects
      </span>
    </section>
  );
}
