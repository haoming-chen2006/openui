/**
 * The X page's state, in a module rather than a context — same reason as `usersStore.ts`.
 *
 * `WorkspaceShell` renders a page's three slots into three sibling regions with the shell in
 * between, so a page cannot wrap them in a provider. Anything two slots share lives here and each
 * slot subscribes through `useSyncExternalStore`.
 *
 * **Selection is not here.** Which draft or record is open is `selectionId` in the URL, owned by
 * the shell and handed to every slot as a prop.
 *
 * Nothing in this file invents a value. An account that will not load is `null` with the error
 * beside it; a draft with no producing agent omits the field rather than defaulting to a plausible
 * one; an unpriced draft stays `null` and renders as "unpriced", never as $0.00.
 */
import { useSyncExternalStore } from "react";
import type { PublishOutcome, PublishRecord, XDraft, XStatus } from "./types";

export interface XState {
  status: XStatus | null;
  drafts: XDraft[];
  records: PublishRecord[];
  /** True until the first load settles, so the page can say "loading" rather than "none". */
  loading: boolean;
  /** A load failure. Distinct from `status.accountError`, which is a connection the user must fix. */
  error: string | null;
  /** The draft id currently being published, so exactly one button can be in flight. */
  publishing: string | null;
  /** The last publish, kept so the page can show what happened without a second fetch. */
  lastOutcome: PublishOutcome | null;
}

let state: XState = {
  status: null,
  drafts: [],
  records: [],
  loading: true,
  error: null,
  publishing: null,
  lastOutcome: null,
};

const listeners = new Set<() => void>();

/** Replace the snapshot, never mutate it — `useSyncExternalStore` compares by identity. */
function set(next: Partial<XState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function snapshot(): XState {
  return state;
}

export function useXState(): XState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Test seam — a suite must not inherit another case's drafts. */
export function resetXState(): void {
  state = {
    status: null,
    drafts: [],
    records: [],
    loading: true,
    error: null,
    publishing: null,
    lastOutcome: null,
  };
  for (const fn of listeners) fn();
}

async function readJson(input: string, init?: RequestInit): Promise<any> {
  const res = await fetch(input, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // The server's own words. A generic "request failed" would discard the dry-run mismatch
    // explanation, which is the one message on this page a user has to act on.
    throw new Error(body?.error || `${init?.method ?? "GET"} ${input} failed with ${res.status}`);
  }
  return body;
}

/**
 * Load everything the page shows, in one pass.
 *
 * Status is fetched first and separately because the other two are meaningless without it: with no
 * credentials there is no account to publish as, and listing drafts under a heading that implies
 * one would be the page claiming a capability it does not have.
 */
export async function loadX(projectId?: string): Promise<void> {
  set({ loading: true, error: null });
  try {
    const status: XStatus = await readJson("/api/x/status");
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const [draftsBody, historyBody] = await Promise.all([
      readJson(`/api/x/drafts${query}`),
      readJson("/api/x/history"),
    ]);
    set({
      status,
      drafts: draftsBody?.drafts ?? [],
      records: historyBody?.records ?? [],
      loading: false,
    });
  } catch (err) {
    set({ loading: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function createDraft(input: {
  text: string;
  projectId?: string;
  draftedByAgentId?: string;
}): Promise<void> {
  try {
    const draft: XDraft = await readJson("/api/x/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    set({ drafts: [draft, ...state.drafts], error: null });
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err) });
  }
}

export async function deleteDraft(id: string): Promise<void> {
  try {
    await readJson(`/api/x/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
    set({ drafts: state.drafts.filter((d) => d.id !== id), error: null });
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Confirm a draft.
 *
 * `dryRun` is sent back exactly as the confirmation dialog showed it, and the server refuses the
 * publish if that disagrees with its own setting. This function must therefore never substitute a
 * fresher value from `state.status` — the whole point of the interlock is that what the human read
 * is what gets checked.
 *
 * `publishing` is set before the request and cleared in `finally`, so a failure cannot leave the
 * button stuck in flight — which on this page would read as "it might still be sending".
 */
export async function publishDraft(input: {
  draftId?: string;
  text?: string;
  confirmedBy: string;
  dryRun: boolean;
  projectId?: string;
}): Promise<PublishOutcome | null> {
  const key = input.draftId ?? "adhoc";
  if (state.publishing) return null;
  set({ publishing: key, error: null });
  try {
    const outcome: PublishOutcome = await readJson("/api/x/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    set({
      lastOutcome: outcome,
      records: [outcome.record, ...state.records.filter((r) => r.id !== outcome.record.id)],
      drafts: input.draftId
        ? state.drafts.map((d) =>
            d.id === input.draftId ? { ...d, publishedRecordId: outcome.record.id } : d,
          )
        : state.drafts,
    });
    return outcome;
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    set({ publishing: null });
  }
}

/** Drafts still awaiting a decision — the list the page's middle section is about. */
export function pendingDrafts(s: XState): XDraft[] {
  return s.drafts.filter((d) => !d.publishedRecordId);
}
