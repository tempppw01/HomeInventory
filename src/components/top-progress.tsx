"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/** Fired by the app shell around in-app view switches: detail is "start" | "done". */
const PROGRESS_EVENT = "home-inventory:progress";
/** A pathname change keeps the bar running for this long before it finishes. */
const ROUTE_TAIL_MS = 420;
/** Creep cadence while running, and the ceiling it approaches until the run ends. */
const CREEP_MS = 180;
const CREEP_CEILING = 90;
/** First visible width, set one frame after the bar is reset to 0. */
const START_MS = 24;
const SEED = 8;
/** Finish sequence: grow to 100%, hold, fade out, reset. */
const FINISH_MS = 200;
const HOLD_MS = 220;
const FADE_MS = 240;

type Phase = "idle" | "running" | "finishing";

/**
 * Thin top progress bar (NProgress-style). It is driven by three merged sources —
 * real route changes, the `home-inventory:progress` window event the app shell
 * fires for cached SPA view switches, and the count of in-flight requests — and it
 * stays invisible and non-interactive while idle.
 */
export function TopProgressBar() {
  const pathname = usePathname();
  const [running, setRunning] = useState(false);
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [reduced, setReduced] = useState(false);
  const sources = useRef(new Set<string>());
  const lastPathname = useRef(pathname);
  const fetchDepth = useRef(0);
  const hasRun = useRef(false);

  // Any number of sources can be active at once; the bar runs until the last one
  // releases its slot, so overlapping sources never interrupt each other.
  const sync = useCallback(() => {
    const next = sources.current.size > 0;
    setRunning((prev) => (prev === next ? prev : next));
  }, []);
  const begin = useCallback((key: string) => { sources.current.add(key); sync(); }, [sync]);
  const end = useCallback((key: string) => { sources.current.delete(key); sync(); }, [sync]);

  // Reduced motion: OS preference or the in-app "减少动效" switch on <html>.
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setReduced(media.matches || document.documentElement.dataset.motion === "reduced");
    const first = window.setTimeout(read, 0);
    media.addEventListener("change", read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    return () => { window.clearTimeout(first); media.removeEventListener("change", read); observer.disconnect(); };
  }, []);

  // Source 1 — real route changes (/items/[id], /consume/[id], ...).
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    let stop: number | undefined;
    const start = window.setTimeout(() => {
      begin("route");
      stop = window.setTimeout(() => end("route"), ROUTE_TAIL_MS);
    }, 0);
    return () => { window.clearTimeout(start); if (stop !== undefined) window.clearTimeout(stop); };
  }, [pathname, begin, end]);

  // Source 2 — explicit events from the app shell (cached SPA view switches make no request).
  useEffect(() => {
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const state = typeof detail === "string" ? detail.trim().toLowerCase() : "";
      if (state === "start") begin("event");
      else if (state === "done") end("event");
    };
    window.addEventListener(PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(PROGRESS_EVENT, onProgress);
  }, [begin, end]);

  // Source 3 — in-flight requests. The wrapper forwards the arguments, resolves
  // with the original promise and rethrows the original rejection unchanged.
  useEffect(() => {
    const original = window.fetch;
    const activeSources = sources.current;
    const wrapped: typeof window.fetch = (...args) => {
      fetchDepth.current += 1;
      if (fetchDepth.current === 1) begin("fetch");
      const settle = () => {
        fetchDepth.current = Math.max(0, fetchDepth.current - 1);
        if (fetchDepth.current === 0) end("fetch");
      };
      let result: Promise<Response>;
      try {
        result = original.apply(window, args);
      } catch (error) {
        settle();
        throw error;
      }
      return result.then(
        (response) => { settle(); return response; },
        (error) => { settle(); throw error; },
      );
    };
    window.fetch = wrapped;
    return () => {
      if (window.fetch === wrapped) window.fetch = original;
      fetchDepth.current = 0;
      activeSources.delete("fetch");
    };
  }, [begin, end]);

  // Animation state machine. Only timers write state, so a long run can never
  // block a new one and the width always restarts from 0 with transitions off
  // before the growth transition is enabled.
  useEffect(() => {
    if (running) {
      if (reduced) {
        const show = window.setTimeout(() => { hasRun.current = true; setPhase("running"); setProgress(100); setVisible(true); }, 0);
        return () => window.clearTimeout(show);
      }
      const reset = window.setTimeout(() => { hasRun.current = true; setPhase("idle"); setProgress(0); setVisible(true); }, 0);
      const grow = window.setTimeout(() => { setPhase("running"); setProgress(SEED); }, START_MS);
      const creep = window.setInterval(() => {
        setProgress((current) => (current >= CREEP_CEILING ? current : Math.min(CREEP_CEILING, current + Math.max(0.5, (CREEP_CEILING - current) * 0.12))));
      }, CREEP_MS);
      return () => { window.clearTimeout(reset); window.clearTimeout(grow); window.clearInterval(creep); };
    }
    if (!hasRun.current) return;
    const complete = window.setTimeout(() => { setPhase("finishing"); setProgress(100); }, 0);
    if (reduced) {
      const hide = window.setTimeout(() => { setVisible(false); setPhase("idle"); setProgress(0); }, 40);
      return () => { window.clearTimeout(complete); window.clearTimeout(hide); };
    }
    const fade = window.setTimeout(() => setVisible(false), FINISH_MS + HOLD_MS);
    const reset = window.setTimeout(() => { setPhase("idle"); setProgress(0); }, FINISH_MS + HOLD_MS + FADE_MS);
    return () => { window.clearTimeout(complete); window.clearTimeout(fade); window.clearTimeout(reset); };
  }, [running, reduced]);

  const transition = reduced || phase === "idle"
    ? "none"
    : phase === "running"
      ? "width 220ms ease-out"
      : `width ${FINISH_MS}ms ease-out`;

  return (
    <div
      role="progressbar"
      aria-label="加载进度"
      aria-hidden={!running}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={running ? Math.round(progress) : undefined}
      data-progress-state={phase}
      className="pointer-events-none fixed left-0 right-0 top-0 z-[200] h-0.5"
      style={{ opacity: visible ? 1 : 0, transition: reduced ? "none" : `opacity ${running ? 160 : FADE_MS}ms ease` }}
    >
      <div
        className="h-full rounded-r-full"
        style={{
          width: `${progress}%`,
          background: "linear-gradient(90deg, color-mix(in srgb, var(--primary) 55%, transparent), var(--primary))",
          boxShadow: "0 0 8px color-mix(in srgb, var(--primary) 45%, transparent)",
          transition,
        }}
      />
    </div>
  );
}
