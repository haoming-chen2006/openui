/**
 * Drafts an agent wrote and a person has not yet confirmed — loops/08-users-and-x.md §3.15.
 *
 * The X page is "three things and no more", and this is the middle one. A draft is the artefact an
 * agent is allowed to produce; publishing it is not, which is the whole of the split that
 * `publish.ts` describes. So this store holds only what stops at the draft, and it holds no state
 * that could be mistaken for a publish: there is no `state`, no `postId`, no `url`.
 *
 * The one field that reaches across is `publishedRecordId`. It is set after `publishToX` settles,
 * and it is what stops the same draft being offered for publication twice. That is belt-and-braces
 * on top of the idempotency key rather than a replacement for it — the key is what makes a double
 * click harmless, and this is what makes the LIST honest a minute later.
 *
 * Same file-per-store shape as `publishRecord.ts`, deliberately: two stores in one directory that
 * persist differently is two sets of failure modes to learn.
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { atomicWriteJson } from "../persistence";

export interface XDraft {
  id: string;
  text: string;
  /** The agent that wrote it. `draft_x_post` is stage 12; until it exists a person can write one. */
  draftedByAgentId?: string;
  projectId?: string;
  /** What the artefact cost to make. `null` means unpriced — never 0 (§22.18). */
  costUsd?: number | null;
  createdAt: string;
  /** The publish record this draft became, once it became one. Absent means still a draft. */
  publishedRecordId?: string;
}

export interface NewDraft {
  text: string;
  draftedByAgentId?: string;
  projectId?: string;
  costUsd?: number | null;
}

export class XDraftStore {
  private readonly path: string;

  constructor(dir: string) {
    // Same reason as PublishRecordStore: atomicWriteJson renames into a directory it does not
    // create, so a first run against a fresh data directory would fail on the first write.
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, "x-drafts.json");
  }

  private read(): XDraft[] {
    if (!existsSync(this.path)) return [];
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as XDraft[];
    } catch {
      // Unlike the publish record, a corrupt draft file is not dangerous to read as empty — no
      // draft has ever left the machine. But it is still a lie about what an agent wrote, so it
      // refuses rather than silently discarding somebody's work.
      throw new Error(`the draft file at ${this.path} is unreadable; it has not been discarded, but it cannot be listed`);
    }
  }

  private write(drafts: XDraft[]): void {
    atomicWriteJson(this.path, drafts);
  }

  /** Newest first. `projectId` filters; omitting it lists every project's drafts. */
  list(projectId?: string): XDraft[] {
    const all = this.read().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return projectId ? all.filter((d) => d.projectId === projectId) : all;
  }

  get(id: string): XDraft | undefined {
    return this.read().find((d) => d.id === id);
  }

  create(input: NewDraft): XDraft {
    const text = input.text.trim();
    if (!text) throw new Error("a draft with no text is not a draft");

    const draft: XDraft = {
      id: `xdraft_${randomBytes(8).toString("hex")}`,
      text,
      createdAt: new Date().toISOString(),
    };
    if (input.draftedByAgentId !== undefined) draft.draftedByAgentId = input.draftedByAgentId;
    if (input.projectId !== undefined) draft.projectId = input.projectId;
    // Distinguished from absent on purpose: `null` is "we tried to price this and could not",
    // which is a different fact from "nothing here was ever priced".
    if (input.costUsd !== undefined) draft.costUsd = input.costUsd;

    const drafts = this.read();
    drafts.push(draft);
    this.write(drafts);
    return draft;
  }

  /**
   * Tie a draft to the record it became.
   *
   * Never throws on an unknown id: this runs *after* a post may already be on a public timeline,
   * and a bookkeeping failure at that point must not turn a successful publish into a 500 that
   * invites the operator to press the button again.
   */
  markPublished(id: string, recordId: string): XDraft | undefined {
    const drafts = this.read();
    const draft = drafts.find((d) => d.id === id);
    if (!draft) return undefined;
    draft.publishedRecordId = recordId;
    this.write(drafts);
    return draft;
  }

  /** Throw a draft away. Returns false when there was nothing to throw away. */
  remove(id: string): boolean {
    const drafts = this.read();
    const next = drafts.filter((d) => d.id !== id);
    if (next.length === drafts.length) return false;
    this.write(next);
    return true;
  }
}

let store: XDraftStore | null = null;
let storeDir: string | null = null;

export function getXDraftStore(): XDraftStore {
  const dir = process.env.OPENUI_DATA_DIR || join(homedir(), ".openui");
  if (!store || storeDir !== dir) {
    store = new XDraftStore(dir);
    storeDir = dir;
  }
  return store;
}

/** Test seam — the suite points `OPENUI_DATA_DIR` at a temp directory per case. */
export function resetXDraftStore(): void {
  store = null;
  storeDir = null;
}
