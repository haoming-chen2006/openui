/**
 * The X page's HTTP surface, mounted at `/api/x` — loops/08-users-and-x.md §3.15, stage 14.
 *
 * Everything here is a thin shell over `server/services/x/**`, which was built in stages 9–13 and
 * then reached by nothing: `publishToX` had tests and no caller, and the page that was supposed to
 * call it was the stage that never ran. This file is that caller, and the reason it is thin is
 * that the rules it has to honour are already enforced one layer down and must not be re-decided
 * here — the idempotency key in `publishRecord.ts`, the claim-before-send ordering in
 * `publish.ts`, the timeout-is-not-a-failure rule in `client.ts`.
 *
 * Three things this file does decide:
 *
 *   1. **`GET /status` is the only thing the page may ask before it renders.** `configured` is what
 *      XAP-008 keys the page's very existence on, so it must answer without credentials and
 *      without a network call.
 *   2. **The dry-run interlock.** The client sends back the `dryRun` it was shown, and a publish is
 *      refused when it disagrees with the server's. Without it, a page rendered while `X_DRY_RUN=1`
 *      and left open across a restart would show "nothing will be sent" over a button that sends.
 *      That is the one failure here that cannot be taken back.
 *   3. **`confirmedBy` is required and is never defaulted.** `publishRecord.ts` says "never the
 *      string 'user'", and a route that filled it in would be the place that broke it.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { MAX_POST_CHARACTERS, XClient, XError, postLength, type XAccount } from "../services/x/client";
import { credentialsFromEnv } from "../services/x/oauth";
import { publishToX } from "../services/x/publish";
import { getPublishRecordStore } from "../services/x/publishRecord";
import { getXDraftStore } from "../services/x/draftStore";

export const xRoutes = new Hono();

function fail(c: Context, err: unknown, status = 400) {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof XError ? err.code : (err as { code?: string })?.code;
  return c.json({ error: message, ...(code ? { code } : {}) }, status as 400);
}

/** Whether this server would send, if asked. Read in one place so status and publish cannot differ. */
function serverDryRun(): boolean {
  return process.env.X_DRY_RUN === "1";
}

// ────────────────────────────────────────────────────────────────────── the connected account

/**
 * `GET /2/users/me` costs a round trip to X and the answer changes about never, so it is cached.
 *
 * A failure is cached too, for a shorter time. A page that re-renders on every keystroke against
 * an account lookup that is timing out would otherwise spend the rate limit finding out it is
 * still timing out — and the rate limit is shared with publishing, which is the thing that matters.
 */
interface AccountCache {
  at: number;
  account: XAccount | null;
  error: string | null;
  dryRun: boolean;
}
let accountCache: AccountCache | null = null;
const ACCOUNT_TTL_MS = 60_000;
const ACCOUNT_ERROR_TTL_MS = 10_000;

/** Test seam: the suite must not inherit a cached account across cases. */
export function resetXAccountCache(): void {
  accountCache = null;
}

async function connectedAccount(): Promise<{ account: XAccount | null; error: string | null }> {
  const dryRun = serverDryRun();
  const ttl = accountCache?.error ? ACCOUNT_ERROR_TTL_MS : ACCOUNT_TTL_MS;
  // The dry-run flag is part of the key, not just the value: the synthetic account and the real
  // one are different answers and a cache that returned one for the other would be a lie about
  // which timeline is connected.
  if (accountCache && accountCache.dryRun === dryRun && Date.now() - accountCache.at < ttl) {
    return { account: accountCache.account, error: accountCache.error };
  }

  const client = new XClient();
  if (!client.hasCredentials) {
    accountCache = { at: Date.now(), account: null, error: null, dryRun };
    return { account: null, error: null };
  }

  try {
    const account = await client.verifyCredentials();
    accountCache = { at: Date.now(), account, error: null, dryRun };
    return { account, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    accountCache = { at: Date.now(), account: null, error, dryRun };
    return { account: null, error };
  }
}

/**
 * What the page needs before it can decide whether it exists at all.
 *
 * `configured` is computed from the environment and never from the account lookup: credentials
 * that are present but rejected are a *connection* problem the page should render, not a reason
 * for the page to vanish. Conflating the two would make a revoked token look like an uninstalled
 * feature.
 */
xRoutes.get("/status", async (c) => {
  const credentials = credentialsFromEnv();
  const configured = !("missing" in credentials);
  const missing = "missing" in credentials ? credentials.missing : [];

  if (!configured) {
    return c.json({ configured, missing, dryRun: serverDryRun(), account: null, accountError: null });
  }

  const { account, error } = await connectedAccount();
  return c.json({ configured, missing, dryRun: serverDryRun(), account, accountError: error });
});

// ─────────────────────────────────────────────────────────────────────────────────── drafts

xRoutes.get("/drafts", (c) => {
  try {
    const projectId = c.req.query("projectId") || undefined;
    return c.json({ drafts: getXDraftStore().list(projectId) });
  } catch (err) {
    return fail(c, err);
  }
});

xRoutes.post("/drafts", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const text = typeof body.text === "string" ? body.text : "";
    // Refused here rather than at publish time. A draft over the limit is a draft nobody can use,
    // and finding that out at the confirmation dialog is finding it out too late to be useful.
    if (postLength(text.trim()) > MAX_POST_CHARACTERS) {
      return fail(
        c,
        new Error(
          `this draft is ${postLength(text.trim())} characters and the limit is ${MAX_POST_CHARACTERS}`,
        ),
      );
    }
    const draft = getXDraftStore().create({
      text,
      draftedByAgentId: typeof body.draftedByAgentId === "string" ? body.draftedByAgentId : undefined,
      projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      costUsd: body.costUsd === null || typeof body.costUsd === "number" ? body.costUsd : undefined,
    });
    return c.json(draft, 201);
  } catch (err) {
    return fail(c, err);
  }
});

xRoutes.delete("/drafts/:id", (c) => {
  try {
    const removed = getXDraftStore().remove(c.req.param("id"));
    if (!removed) return c.json({ error: "no such draft" }, 404);
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────── publish

/**
 * The one endpoint in this product that can put something on a public timeline.
 *
 * It is a POST from the page and nothing else — no MCP tool reaches it, by the argument in
 * `publish.ts`. What this handler adds to that service call is the interlock: the caller states
 * which of the two things it believes it is doing, and a disagreement is refused rather than
 * resolved. Resolving it in either direction is a guess about a public, permanent action.
 */
xRoutes.post("/publish", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));

    const confirmedBy = typeof body.confirmedBy === "string" ? body.confirmedBy.trim() : "";
    if (!confirmedBy) {
      return fail(c, new Error("confirmedBy is required: a publish records who pressed the button"));
    }

    const draftStore = getXDraftStore();
    const draftId = typeof body.draftId === "string" ? body.draftId : undefined;
    const draft = draftId ? draftStore.get(draftId) : undefined;
    if (draftId && !draft) return c.json({ error: "no such draft" }, 404);
    if (draft?.publishedRecordId) {
      // Not an idempotent re-answer: the key would differ by the second, so this would be a second
      // post of the same words rather than the same post returned twice.
      return c.json(
        { error: "this draft has already been published", recordId: draft.publishedRecordId },
        409,
      );
    }

    const text = (draft?.text ?? (typeof body.text === "string" ? body.text : "")).trim();
    if (!text) return fail(c, new Error("there is nothing to post"));

    const dryRun = serverDryRun();
    // The interlock. `body.dryRun` is what the confirmation dialog told the user was about to
    // happen; a mismatch means the page is describing a different action from the one it would
    // take, and the safe resolution of that is neither.
    if (typeof body.dryRun === "boolean" && body.dryRun !== dryRun) {
      return c.json(
        {
          error:
            `this page was showing a ${body.dryRun ? "dry run" : "real post"} and the server is set to ` +
            `${dryRun ? "dry run" : "post for real"}. Nothing was sent. Reload the page and read the ` +
            `confirmation again.`,
          code: "dry_run_mismatch",
          dryRun,
        },
        409,
      );
    }

    const outcome = await publishToX(
      {
        text,
        confirmedBy,
        // Recorded, never hidden: there is one principal in this workspace (see the users page),
        // so every confirmation here is a self-approval and the record says so.
        selfApproved: true,
        draftedByAgentId: draft?.draftedByAgentId,
        projectId: draft?.projectId ?? (typeof body.projectId === "string" ? body.projectId : undefined),
        costUsd: draft?.costUsd ?? null,
      },
      new XClient({ dryRun }),
      getPublishRecordStore(),
    );

    if (draft && !outcome.deduplicated) draftStore.markPublished(draft.id, outcome.record.id);

    // 200 even for `refused` and `unknown`: the call itself succeeded and its result is the body.
    // An HTTP error would lose the record id, which is the only handle a human has on an `unknown`.
    return c.json({
      record: outcome.record,
      post: outcome.post ?? null,
      deduplicated: outcome.deduplicated,
    });
  } catch (err) {
    return fail(c, err, 500);
  }
});

// ────────────────────────────────────────────────────────────────────────────────── history

xRoutes.get("/history", (c) => {
  try {
    return c.json({ records: getPublishRecordStore().list() });
  } catch (err) {
    return fail(c, err);
  }
});
