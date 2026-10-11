import { useEffect, useRef } from "react";

const EVENT = "plexrust:library-changed";

/** Tells every screen that watched state or Continue Watching changed. */
export function notifyLibraryChanged() {
  window.dispatchEvent(new Event(EVENT));
}

/** Runs `onChange` whenever {@link notifyLibraryChanged} fires. */
export function useLibraryChanged(onChange: () => void) {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    const handler = () => latest.current();
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);
}
