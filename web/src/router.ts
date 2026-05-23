import { useEffect, useState } from "react";

/**
 * Tiny history-router. Routes are real paths like `/keys` or `/admin/bots`.
 *
 * Why History API and not hash? Hash routes (`/#/keys`) look unprofessional
 * and break sharing/copy-paste. Production already serves `index.html` for
 * unmatched GETs (see `server/src/index.ts` setNotFoundHandler) and Vite's
 * dev server does the same out of the box, so SPA paths resolve everywhere.
 */
export type Route = string;

const ROUTE_CHANGE_EVENT = "qqnotice:route";

export function getCurrentRoute(): Route {
  const p = window.location.pathname;
  return p === "" ? "/" : p;
}

/**
 * Migrate any legacy `#/foo` URL the user might still have bookmarked. Run
 * once at module load — `replaceState` so it doesn't pollute history.
 */
if (typeof window !== "undefined" && window.location.hash.startsWith("#/")) {
  const legacy = window.location.hash.slice(1);
  window.history.replaceState({}, "", legacy || "/");
}

export function navigate(route: Route): void {
  const next = route.startsWith("/") ? route : `/${route}`;
  if (getCurrentRoute() === next) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => getCurrentRoute());
  useEffect(() => {
    function onChange(): void {
      setRoute(getCurrentRoute());
    }
    // `popstate` fires on browser back/forward; the custom event fires
    // on programmatic navigate() calls (pushState doesn't trigger popstate).
    window.addEventListener("popstate", onChange);
    window.addEventListener(ROUTE_CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener(ROUTE_CHANGE_EVENT, onChange);
    };
  }, []);
  return route;
}
