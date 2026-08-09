/**
 * The X page, MAIN region — loops/08-users-and-x.md §3.15, stage 14.
 *
 * "The page, when present, is three things and no more: the connected account and its
 * connect/disconnect control; the drafts agents have written, each with a Publish button that opens
 * §3.12; and the history of what has been published, with who confirmed it and what it cost."
 *
 * Those three, in that order, and nothing else. Two departures from that sentence, each stated on
 * screen rather than papered over:
 *
 *   - **there is no connect/disconnect control.** The connection is four values in the server's
 *     environment, not a per-user OAuth grant — `credentialsFromEnv()` reads `consumer_key`,
 *     `consumer_secret`, `x_access_token` and `x_access_secret`. A Disconnect button would have to
 *     edit the server's environment from the browser, which it cannot, and §3.15 prohibits showing
 *     a control that does nothing. So the account is stated and the way to change it is named.
 *   - **the drafts are not all agents'.** `draft_x_post` is stage 12 and does not exist, so no agent
 *     can write one yet. Rather than an empty list under a heading that implies otherwise, a person
 *     can write a draft here — and a draft written that way says so, in the row and again in the
 *     confirmation, instead of being attributed to an agent that did not write it.
 */
import { useEffect, useState } from "react";
import type { WorkspacePageProps } from "../../shell/contract";
import { ConfirmPublish } from "./ConfirmPublish";
import { MAX_POST_CHARACTERS, type PublishRecord, type XDraft } from "./types";
import {
  createDraft,
  deleteDraft,
  loadX,
  pendingDrafts,
  publishDraft,
  useXState,
} from "./xStore";

/**
 * Who the record says pressed the button.
 *
 * The users page's `THIS_MACHINE`, by id. Nobody signs in, so there is exactly one principal and
 * this is it — a real answer rather than a default. `publishRecord.ts` forbids the string "user"
 * for precisely the case where a route invents one; this is the id of the row that page renders.
 */
const CONFIRMED_BY = "owner_this_machine";

function money(value: number | null | undefined): string {
  if (value === null) return "unpriced";
  if (value === undefined) return "not priced";
  return `$${value.toFixed(2)}`;
}

function when(iso: string): string {
  // Locale-formatted, because this is the one place a wall-clock time is what the reader wants:
  // "did I send this before or after the meeting" is the question a history answers.
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ────────────────────────────────────────────────────────────── 1. the connected account

function AccountHeader({
  configured,
  dryRun,
  account,
  accountError,
}: {
  configured: boolean;
  dryRun: boolean;
  account: { username: string; name: string } | null;
  accountError: string | null;
}) {
  return (
    <header className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h1 className="text-[17px] text-ink">Posting to X</h1>
        <p data-testid="x-account-line" className="mt-0.5 text-[12px] text-ink-ghost">
          {!configured
            ? "No X application is configured on this server."
            : accountError
              ? `The account could not be read: ${accountError}`
              : account
                ? `Connected as @${account.username} — ${account.name}. The connection is this ` +
                  `server's four X credentials, so it is changed in the environment, not from here.`
                : "Reading the connected account…"}
        </p>
      </div>
      <div className="flex-1" />
      {/* The one fact that changes what every button on this page does, stated at the top. */}
      <span
        data-testid="x-mode"
        className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${
          dryRun
            ? "border-status-waiting text-status-waiting"
            : "border-status-failed text-status-failed"
        }`}
      >
        {dryRun ? "dry run — nothing is sent" : "live — posts are public"}
      </span>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────── 2. the drafts

function Compose({ projectId }: { projectId: string }) {
  const [text, setText] = useState("");
  const length = [...text].length;
  const overLimit = length > MAX_POST_CHARACTERS;

  return (
    <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
      <textarea
        data-testid="x-compose"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Write a draft. Nothing here is sent until you confirm it."
        className="w-full resize-y rounded border border-border bg-surface px-3 py-2 text-[15px] leading-snug text-ink placeholder:text-ink-ghost"
      />
      <div className="flex items-center gap-3">
        <span
          data-testid="x-compose-count"
          className={`font-mono text-[11px] ${overLimit ? "text-status-failed" : "text-ink-ghost"}`}
        >
          {length} / {MAX_POST_CHARACTERS}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          data-testid="x-compose-save"
          disabled={length === 0 || overLimit}
          onClick={() => {
            void createDraft({ text, projectId });
            setText("");
          }}
          className="rounded-[7px] border border-border-strong px-3 py-1.5 text-[13px] text-ink-muted hover:bg-surface-hover disabled:opacity-40"
        >
          Save as draft
        </button>
      </div>
    </div>
  );
}

function DraftRow({
  draft,
  selected,
  onSelect,
  onPublish,
}: {
  draft: XDraft;
  selected: boolean;
  onSelect: () => void;
  onPublish: () => void;
}) {
  return (
    <div
      data-testid={`x-draft-${draft.id}`}
      aria-current={selected ? "true" : undefined}
      className={`flex items-start gap-3 border-b border-l-2 border-border px-4 py-3 ${
        selected ? "border-l-accent bg-accent/10" : "border-l-transparent"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 text-left"
        title="Show this draft in the inspector"
      >
        <span className="block whitespace-pre-wrap text-[15px] leading-snug text-ink">
          {draft.text}
        </span>
        <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-ghost">
          {/*
            Attribution, or the honest absence of it. `draft_x_post` is stage 12, so today every
            draft is the second case; when the tool lands the first case starts appearing and this
            row does not have to change.
          */}
          {draft.draftedByAgentId ? `drafted by ${draft.draftedByAgentId}` : "written here, not by an agent"}
          {" · "}
          {money(draft.costUsd)}
          {" · "}
          {when(draft.createdAt)}
        </span>
      </button>
      <button
        type="button"
        data-testid={`x-publish-${draft.id}`}
        onClick={onPublish}
        className="shrink-0 rounded-[7px] border border-link bg-link/[0.14] px-3 py-1.5 text-[13px] text-ink"
      >
        Publish…
      </button>
      <button
        type="button"
        data-testid={`x-discard-${draft.id}`}
        onClick={() => void deleteDraft(draft.id)}
        title="Throw this draft away"
        className="shrink-0 rounded-[7px] border border-border px-2.5 py-1.5 text-[13px] text-ink-faint hover:bg-surface-hover"
      >
        Discard
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────── 3. the history

const STATE_STYLE: Record<PublishRecord["state"], string> = {
  published: "border-status-complete text-status-complete",
  refused: "border-status-failed text-status-failed",
  // Neither of these is a failure. `in_flight` and `unknown` both mean a person has to look at the
  // account, which is why they carry the waiting colour and not the failed one (§3.13).
  in_flight: "border-status-working text-status-working",
  unknown: "border-status-waiting text-status-waiting",
};

function RecordRow({
  record,
  selected,
  onSelect,
}: {
  record: PublishRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`x-record-${record.id}`}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={`flex w-full items-start gap-3 border-b border-l-2 border-border px-4 py-3 text-left ${
        selected ? "border-l-accent bg-accent/10" : "border-l-transparent hover:bg-surface-hover"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-ink-muted">{record.text}</span>
        <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-ghost">
          confirmed by {record.confirmedBy}
          {record.selfApproved ? " (self-approved)" : ""} · {money(record.costUsd)} ·{" "}
          {when(record.confirmedAt)}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={`rounded border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.06em] ${
            STATE_STYLE[record.state]
          }`}
        >
          {record.state.replace("_", " ")}
        </span>
        {record.dryRun ? (
          // Never omitted on a dry run. A record that looks like a post and was not one is the
          // single most misleading row this page could draw.
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-ghost">
            dry run
          </span>
        ) : null}
      </span>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────── the page

function XMain({ projectId, selectionId, onSelect }: WorkspacePageProps) {
  const state = useXState();
  const [confirming, setConfirming] = useState<XDraft | null>(null);

  useEffect(() => {
    void loadX(projectId || undefined);
  }, [projectId]);

  const drafts = pendingDrafts(state);
  const configured = state.status?.configured ?? false;
  const dryRun = state.status?.dryRun ?? true;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <AccountHeader
        configured={configured}
        dryRun={dryRun}
        account={state.status?.account ?? null}
        accountError={state.status?.accountError ?? null}
      />

      {state.error ? (
        <p role="alert" data-testid="x-error" className="border-b border-border px-4 py-2 text-[12px] text-status-failed">
          {state.error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Compose projectId={projectId} />

        <h2 className="border-b border-border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-ghost">
          Waiting for a person — {drafts.length}
        </h2>
        {state.loading ? (
          <p className="px-4 py-6 text-[13px] text-ink-faint">Loading…</p>
        ) : drafts.length === 0 ? (
          <p data-testid="x-drafts-empty" className="px-4 py-6 text-[13px] text-ink-faint">
            No drafts. Agents cannot write one yet — <span className="font-mono">draft_x_post</span>{" "}
            is stage 12 of loop 08 and is not built — so until it lands, drafts are written above.
          </p>
        ) : (
          drafts.map((draft) => (
            <DraftRow
              key={draft.id}
              draft={draft}
              selected={draft.id === selectionId}
              onSelect={() => onSelect(draft.id === selectionId ? undefined : draft.id)}
              onPublish={() => setConfirming(draft)}
            />
          ))
        )}

        <h2 className="border-b border-t border-border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-ghost">
          Published — {state.records.length}
        </h2>
        {state.records.length === 0 ? (
          <p data-testid="x-history-empty" className="px-4 py-6 text-[13px] text-ink-faint">
            Nothing has been published from this workspace.
          </p>
        ) : (
          state.records.map((record) => (
            <RecordRow
              key={record.id}
              record={record}
              selected={record.id === selectionId}
              onSelect={() => onSelect(record.id === selectionId ? undefined : record.id)}
            />
          ))
        )}
      </div>

      {confirming ? (
        <ConfirmPublish
          draft={confirming}
          account={state.status?.account ?? null}
          // The value the dialog SHOWS is the value it sends. The server refuses the publish if
          // that disagrees with its own setting, so this must not be re-read at click time.
          dryRun={dryRun}
          busy={state.publishing === confirming.id}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const draft = confirming;
            void publishDraft({
              draftId: draft.id,
              confirmedBy: CONFIRMED_BY,
              dryRun,
              projectId: draft.projectId ?? projectId,
            }).then((outcome) => {
              setConfirming(null);
              // Select the record so the inspector opens on what just happened — which for
              // `unknown` is the one state the user has to act on.
              if (outcome) onSelect(outcome.record.id);
            });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The MAIN slot.
 *
 * A wrapper rather than the component itself, for the reason `UsersPage.tsx` documents:
 * `WorkspaceShell` invokes slots as plain functions, so a slot that used hooks directly would have
 * them counted against the shell's fiber.
 */
export const XPageMain = (props: WorkspacePageProps) => <XMain {...props} />;
