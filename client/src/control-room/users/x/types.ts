/**
 * The client's view of the X surface — loops/08-users-and-x.md §3.15.
 *
 * Structural copies of `server/services/x/publishRecord.ts` and `server/services/x/draftStore.ts`
 * rather than imports: the client build does not reach into `server/`, which is the same reason
 * `assets/useAssets.ts` restates its shapes. The field names are the server's exactly, so a rename
 * there is a typecheck failure here rather than a field that silently reads `undefined`.
 */

/** `in_flight` and `unknown` are both "a human has to look" — never "it failed". */
export type PublishState = "in_flight" | "published" | "refused" | "unknown";

export interface PublishRecord {
  id: string;
  state: PublishState;
  text: string;
  confirmedBy: string;
  selfApproved: boolean;
  draftedByAgentId?: string;
  projectId?: string;
  assetId?: string;
  postId?: string;
  url?: string;
  dryRun: boolean;
  /** `null` is priced-and-unknown; absent is never-priced. Neither is ever rendered as $0. */
  costUsd?: number | null;
  error?: string;
  confirmedAt: string;
  settledAt?: string;
}

export interface XDraft {
  id: string;
  text: string;
  draftedByAgentId?: string;
  projectId?: string;
  costUsd?: number | null;
  createdAt: string;
  publishedRecordId?: string;
}

export interface XAccount {
  id: string;
  username: string;
  name: string;
}

/**
 * What `GET /api/x/status` answers.
 *
 * `configured` and `accountError` are deliberately independent. Credentials that are present but
 * rejected leave `configured: true` with an error to render — a revoked token is a connection the
 * user has to fix, not a feature that was never installed, and collapsing the two would remove the
 * page at the exact moment it has something to say.
 */
export interface XStatus {
  configured: boolean;
  /** Which of the four credential names are absent. Empty when configured. */
  missing: string[];
  dryRun: boolean;
  account: XAccount | null;
  accountError: string | null;
}

/** What `POST /api/x/publish` answers. A refusal is a 200 with a `refused` record, not an HTTP error. */
export interface PublishOutcome {
  record: PublishRecord;
  post: { id: string; text: string; dryRun: boolean; url?: string; at: string } | null;
  deduplicated: boolean;
}

/** X's own limit, restated for the character counter. `server/services/x/client.ts` is the source. */
export const MAX_POST_CHARACTERS = 280;
