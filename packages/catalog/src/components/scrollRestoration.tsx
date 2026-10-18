import * as React from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * New pages start at the top, and Back or Forward returns to where you were. The
 * Catalog uses a plain router, which does not restore scroll positions itself.
 */
export function ScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const positions = React.useRef(new Map<string, number>());
  const previousPathname = React.useRef(location.pathname);

  React.useEffect(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
  }, []);

  // Track the position of the current history entry while the reader scrolls.
  React.useEffect(() => {
    const key = location.key;
    const remember = () => positions.current.set(key, window.scrollY);

    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [location.key]);

  React.useEffect(() => {
    const pathnameChanged = previousPathname.current !== location.pathname;
    previousPathname.current = location.pathname;

    // Anchors scroll themselves; filter and search changes keep the reader where they are.
    if (location.hash || !pathnameChanged) return;

    if (navigationType !== "POP") {
      window.scrollTo(0, 0);
      return;
    }

    const target = positions.current.get(location.key);
    if (target === undefined) {
      window.scrollTo(0, 0);
      return;
    }

    // The page may still be loading, so keep trying until it is tall enough.
    let frame = 0;
    let attempts = 0;
    const restore = () => {
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) > 2 && attempts++ < 90) {
        frame = window.requestAnimationFrame(restore);
      }
    };
    restore();

    return () => window.cancelAnimationFrame(frame);
  }, [location.key, location.pathname, location.hash, navigationType]);

  return null;
}
