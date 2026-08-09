/**
 * The X page, INSPECTOR region — properties only, never navigation (shell contract).
 *
 * Whatever `selectionId` names: a draft, or a publish record. It resolves against both because the
 * URL segment is opaque to the shell and MAIN offers both kinds of row, and because the interesting
 * case — a record in state `unknown` — is reached by selecting it right after confirming.
 *
 * An `unknown` record gets the whole of §3.13 spelled out, because that is the one state on this
 * page where the correct next action is counter-intuitive: the thing that looks like a failure may
 * be a post that exists, and the instinct to press the button again is what turns it into two.
 */
import type { WorkspacePageProps } from "../../shell/contract";
import type { PublishRecord, XDraft } from "./types";
import { useXState } from "./xStore";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1 text-[12px]">
      <span className="w-[92px] shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-ghost">
        {label}
      </span>
      <span className="min-w-0 break-words text-ink-muted">{children}</span>
    </div>
  );
}

function money(value: number | null | undefined): string {
  if (value === null) return "unpriced — this could not be priced";
  if (value === undefined) return "not priced";
  return `$${value.toFixed(2)}`;
}

function DraftDetail({ draft }: { draft: XDraft }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-ghost">Draft</h2>
      <p className="whitespace-pre-wrap text-[14px] leading-snug text-ink">{draft.text}</p>
      <div className="border-t border-border pt-2">
        <Row label="Id">{draft.id}</Row>
        <Row label="Drafted by">
          {draft.draftedByAgentId ?? "nobody — written in this page, not by an agent"}
        </Row>
        <Row label="Project">{draft.projectId ?? "not attached to a project"}</Row>
        <Row label="Cost to make">{money(draft.costUsd)}</Row>
        <Row label="Written">{draft.createdAt}</Row>
      </div>
    </div>
  );
}

function RecordDetail({ record }: { record: PublishRecord }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-ghost">
        {record.state.replace("_", " ")}
        {record.dryRun ? " · dry run" : ""}
      </h2>
      <p className="whitespace-pre-wrap text-[14px] leading-snug text-ink">{record.text}</p>

      <div className="border-t border-border pt-2">
        <Row label="Record">{record.id}</Row>
        <Row label="Confirmed by">
          {record.confirmedBy}
          {record.selfApproved ? " — self-approved, and recorded as such" : ""}
        </Row>
        <Row label="Drafted by">{record.draftedByAgentId ?? "not an agent's draft"}</Row>
        <Row label="Project">{record.projectId ?? "not attached to a project"}</Row>
        <Row label="Cost to make">{money(record.costUsd)}</Row>
        <Row label="Cost to send">$0.00 — posting is free</Row>
        <Row label="Confirmed">{record.confirmedAt}</Row>
        {record.settledAt ? <Row label="Settled">{record.settledAt}</Row> : null}
        {record.postId ? <Row label="Post">{record.postId}</Row> : null}
        {record.url ? (
          <Row label="Link">
            <a href={record.url} target="_blank" rel="noreferrer" className="text-link underline">
              {record.url}
            </a>
          </Row>
        ) : null}
        {record.error ? <Row label="X said">{record.error}</Row> : null}
      </div>

      {record.state === "unknown" ? (
        <p
          data-testid="x-unknown-guidance"
          className="rounded border border-status-waiting px-2.5 py-2 text-[12px] leading-snug text-status-waiting"
        >
          This is not a failure. The connection dropped before X answered, so this post may exist.
          Open the account and look for these words. If it is there, nothing more is needed. If it
          is not, write a new draft — never confirm this one again, because a second attempt cannot
          tell the two cases apart either.
        </p>
      ) : null}
    </div>
  );
}

function XInspect({ selectionId }: WorkspacePageProps) {
  const state = useXState();

  if (!selectionId) {
    return (
      <p className="px-3 py-3 text-[12px] text-ink-faint">
        Select a draft or a published post to see what it is, who confirmed it and what it cost.
      </p>
    );
  }

  const draft = state.drafts.find((d) => d.id === selectionId);
  if (draft) return <DraftDetail draft={draft} />;

  const record = state.records.find((r) => r.id === selectionId);
  if (record) return <RecordDetail record={record} />;

  // A selection the page cannot resolve — a stale deep link, or a draft discarded in another tab.
  // Said, rather than rendered as an empty panel that reads like a loading state that never ends.
  return (
    <p data-testid="x-selection-gone" className="px-3 py-3 text-[12px] text-ink-faint">
      Nothing here answers to <span className="font-mono">{selectionId}</span> any more.
    </p>
  );
}

export const XPageInspector = (props: WorkspacePageProps) => <XInspect {...props} />;
