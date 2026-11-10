// SPDX-License-Identifier: AGPL-3.0-or-later
import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { REPO_URL } from "@/links";
import { GithubIcon } from "../icons/GithubIcon";

const API_URL = "https://api.github.com/repos/H4kken/vitryne";
const CACHE_KEY = "vitryne-github-stars";
/** GitHub allows 60 anonymous calls an hour per address: ask at most every 6 hours. */
const CACHE_MS = 6 * 60 * 60 * 1000;

function readCache(): { count: number; at: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    return typeof v?.count === "number" && typeof v?.at === "number" ? v : null;
  } catch {
    return null;
  }
}

/** 1234 → "1.2k". */
function formatStars(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
}

/** Counts from 0 up to `target` when it first shows (at once with reduced motion). */
function useCountUp(target: number | null, ms = 1200): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    if (target === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const p = Math.min((now - t0) / ms, 1);
      setValue(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

/** The repository's star count from GitHub's public API, cached; null until known or when it fails. */
function useStars(): number | null {
  const [count, setCount] = useState<number | null>(
    () => readCache()?.count ?? null,
  );
  useEffect(() => {
    const cached = readCache();
    if (cached && Date.now() - cached.at < CACHE_MS) return;
    const ctl = new AbortController();
    fetch(API_URL, {
      signal: ctl.signal,
      referrerPolicy: "no-referrer",
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then((j: { stargazers_count?: unknown }) => {
        if (typeof j.stargazers_count !== "number") return;
        setCount(j.stargazers_count);
        try {
          localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({ count: j.stargazers_count, at: Date.now() }),
          );
        } catch {
          // Private window or blocked storage: the count just isn't remembered.
        }
      })
      .catch(() => {
        // Offline, rate-limited or blocked: the link shows without a number.
      });
    return () => ctl.abort();
  }, []);
  return count;
}

/** A link to the repository with its star count, in the start screen's top bar. */
export function GithubStars() {
  const stars = useStars();
  const shown = useCountUp(stars);
  return (
    <Button variant="outline" size="sm" asChild>
      <a
        className="group"
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        aria-label={
          stars === null
            ? "Vitryne on GitHub"
            : `Vitryne on GitHub, ${stars} stars`
        }
      >
        <GithubIcon />
        {stars !== null && shown !== null && (
          <span className="text-muted-foreground flex items-center gap-1">
            <Star className="size-3.5 fill-yellow-400 text-yellow-400 transition-[transform,filter] duration-200 group-hover:scale-125 group-hover:drop-shadow-[0_0_5px_rgb(250_204_21/0.9)] motion-reduce:transition-none" />
            <span className="tabular-nums">{formatStars(shown)}</span>
          </span>
        )}
      </a>
    </Button>
  );
}
