"use client";

import { useEffect, useRef } from "react";

// Nested dialogs share one window-level listener, so the innermost one that is
// still mounted is the only one that reacts to Escape.
const stack: symbol[] = [];

export function useEscapeClose(onClose: () => void, active = true) {
  const handler = useRef(onClose);

  // Writing the ref during render is unsafe under concurrent rendering, so the
  // latest callback is stored in an effect. Effects run in declaration order, so
  // the listener below always sees the current handler.
  useEffect(() => {
    handler.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;
    const id = Symbol("escape-close");
    stack.push(id);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (stack[stack.length - 1] !== id) return;
      event.preventDefault();
      handler.current();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const index = stack.indexOf(id);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [active]);
}
