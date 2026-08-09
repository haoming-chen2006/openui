/**
 * Whether the X page exists at all — XAP-008.
 *
 * "Optional means absent": with no X credentials configured the page is not disabled, not greyed,
 * not shown with a connect-to-enable empty state. It is not in the navigation. That is a stronger
 * requirement than it looks, because the fact it turns on lives on the server and the navigation
 * is drawn on the client.
 *
 * **It starts hidden and is revealed, never the other way round.** A probe that defaulted to
 * "present" and removed the tab a moment later would put a page in the navigation that XAP-008
 * says must never appear there — briefly, on every load, for every workspace that has no X
 * application. Being wrong in the reassuring direction is the defect; the same argument
 * `shell/NotMergedYet.tsx` makes about a slot, applied to the tab that opens it.
 *
 * One probe per page load. The answer is an environment variable's presence on the server and
 * cannot change while the tab is open — anything that did change it (editing `.env`) restarts the
 * server, which reloads the client.
 */
import { useSyncExternalStore } from "react";

let configured = false;
let probed = false;
const listeners = new Set<() => void>();

function publish(next: boolean): void {
  if (configured === next) return;
  configured = next;
  for (const fn of listeners) fn();
}

function probe(): void {
  if (probed) return;
  probed = true;
  // `fetch` is absent in some test environments, and a page registry that throws at import time
  // takes the whole shell down with it. Unavailable means unconfirmed means hidden.
  if (typeof fetch !== "function") return;
  void (async () => {
    try {
      const res = await fetch("/api/x/status");
      if (!res.ok) return;
      const body = await res.json();
      publish(body?.configured === true);
    } catch {
      // A status endpoint that cannot be reached is not evidence that X is configured.
    }
  })();
}

function subscribe(fn: () => void): () => void {
  probe();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function snapshot(): boolean {
  return configured;
}

/** True once the server has confirmed X credentials exist. False until then, and false without them. */
export function useXConfigured(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** Test seam. Sets the answer directly and skips the probe. */
export function setXConfiguredForTest(next: boolean | null): void {
  if (next === null) {
    probed = false;
    publish(false);
    return;
  }
  probed = true;
  publish(next);
}
