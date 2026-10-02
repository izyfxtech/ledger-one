import { createStore } from "@tanstack/react-store";
import type { QueryClient } from "@tanstack/react-query";
import { loadDisplayName, setTourComplete } from "@/lib/local-store";
import { appKeys } from "@/lib/query-client";
import { buildSteps, type TourStep } from "@/components/tour";

// Tour controller. The step index and the highlighted element's rect live in
// a Store; "navigate, then wait for the target to exist" is an async
// function rather than an effect + polling timer inside the component.

type Rect = { top: number; left: number; width: number; height: number };

export const tourStore = createStore({
  steps: [] as TourStep[],
  index: 0,
  rect: null as Rect | null,
});

type Navigate = (opts: { to: string }) => unknown;
let navigate: Navigate = () => {};
let token = 0; // invalidates in-flight waits when the step changes

const measure = (sel: string): Rect | null => {
  const el = document.querySelector(sel) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

async function waitForTarget(sel: string, mine: number) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (mine !== token) return;
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      tourStore.setState((s) => ({ ...s, rect: measure(sel) }));
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (mine === token) tourStore.setState((s) => ({ ...s, rect: null }));
}

export const tour = {
  goTo(index: number) {
    const mine = ++token;
    const step = tourStore.get().steps[index];
    if (!step) return;
    tourStore.setState((s) => ({ ...s, index }));
    if (step.path) navigate({ to: step.path });
    void waitForTarget(step.target, mine);
  },
  async finish() {
    token++;
    await setTourComplete();
    tourStore.setState((s) => ({ ...s, index: 0, rect: null }));
  },
};

/** Wire the controller to the router and start it when the stored tour
 *  state flips to incomplete (end of onboarding, Settings → Restart tour). */
export function installTour(nav: Navigate, qc: QueryClient) {
  navigate = nav;
  const reflow = () => {
    const { steps, index } = tourStore.get();
    const step = steps[index];
    if (step) tourStore.setState((s) => ({ ...s, rect: measure(step.target) ?? s.rect }));
  };
  window.addEventListener("resize", reflow);
  window.addEventListener("scroll", reflow, true);

  qc.getQueryCache().subscribe((e) => {
    if (e.type !== "updated" || e.query.queryKey[0] !== appKeys.tour[0]) return;
    const data = e.query.state.data as { complete: boolean } | undefined;
    if (data && !data.complete && tourStore.get().steps.length === 0) {
      tourStore.setState((s) => ({ ...s, steps: buildSteps(loadDisplayName()), index: 0 }));
      tour.goTo(0);
    } else if (data?.complete && tourStore.get().steps.length > 0) {
      tourStore.setState((s) => ({ ...s, steps: [], rect: null, index: 0 }));
    }
  });
}
