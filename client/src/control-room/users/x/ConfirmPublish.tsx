/**
 * The confirmation — loops/08-users-and-x.md §3.12, and the screen half of `x/demo.ts`.
 *
 * `renderConfirmation()` in `server/services/x/demo.ts` is the same content in text, and its header
 * says so: "the screen version of this is the same content in the shape `x-page.html` draws; the
 * words are the part that matters and they live here so both surfaces say the same thing." The
 * lines below are that list, in the same order, with the same two closing sentences.
 *
 * Three things it does that a generic confirm dialog does not:
 *
 *   - **it shows the artefact, not a summary of it.** The post is rendered at the size it will be
 *     read, not as "Publish this draft?" over a truncated preview. A person approving words they
 *     cannot see is not approving anything.
 *   - **it names what cannot be undone**, in those words. "Deleting it later does not unsend it" is
 *     the fact that makes this different from every other destructive confirm in the product.
 *   - **it states which of the two things is about to happen.** The dry-run line and the permanent
 *     line are mutually exclusive and one of them is always present. The value shown here is the
 *     value sent back to the server, which refuses the publish if it disagrees — so this text
 *     cannot be stale relative to what happens next.
 */
import { useEffect, useRef } from "react";
import { MAX_POST_CHARACTERS, type XAccount, type XDraft } from "./types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-[12px]">
      <span className="w-[104px] shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-ghost">
        {label}
      </span>
      <span className="min-w-0 text-ink-muted">{children}</span>
    </div>
  );
}

export function ConfirmPublish({
  draft,
  account,
  dryRun,
  busy,
  onConfirm,
  onCancel,
}: {
  draft: XDraft;
  /** Null when the account could not be read. The dialog says so rather than inventing a handle. */
  account: XAccount | null;
  dryRun: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus lands on Cancel, not on Publish. A dialog that opens with the irreversible action
  // focused turns a stray Return keypress into a public post.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const length = [...draft.text].length;
  const cost =
    draft.costUsd === null || draft.costUsd === undefined
      ? "unknown — this could not be priced"
      : `$${draft.costUsd.toFixed(2)}`;

  return (
    <div
      data-testid="x-confirm"
      role="dialog"
      aria-modal="true"
      aria-label="Publish to X"
      className="absolute inset-0 z-20 flex items-center justify-center bg-scrim p-6"
    >
      <div className="w-full max-w-lg rounded-lg border border-border-strong bg-surface shadow-lg">
        <header className="flex items-baseline gap-2 border-b border-border px-4 py-3">
          <h2 className="text-[15px] text-ink">Publish to X</h2>
          <span className="flex-1" />
          <span data-testid="x-confirm-account" className="font-mono text-[11px] text-ink-ghost">
            {account ? `posting as @${account.username}` : "the account could not be read"}
          </span>
        </header>

        {/* The artefact itself, at reading size. */}
        <p
          data-testid="x-confirm-text"
          className="whitespace-pre-wrap px-4 py-4 text-[15px] leading-snug text-ink"
        >
          {draft.text}
        </p>

        <div className="flex flex-col gap-1.5 border-t border-border px-4 py-3">
          <Field label="Length">
            <span className={length > MAX_POST_CHARACTERS ? "text-status-failed" : undefined}>
              {length} / {MAX_POST_CHARACTERS} characters
            </span>
          </Field>
          <Field label="Drafted by">
            {draft.draftedByAgentId ?? "nobody — this was written here, not by an agent"}
          </Field>
          <Field label="Project">{draft.projectId ?? "not attached to a project"}</Field>
          <Field label="Cost to make">{cost}</Field>
          <Field label="Cost to send">$0.00 — posting is free; media is what costs money</Field>
        </div>

        <p
          data-testid="x-confirm-consequence"
          className={`border-t px-4 py-3 text-[13px] leading-snug ${
            dryRun
              ? "border-border text-ink-muted"
              : "border-status-failed bg-status-failed/10 text-status-failed"
          }`}
        >
          {dryRun
            ? "DRY RUN — nothing will be sent. The record will say so."
            : "This is public and permanent. Deleting it later does not unsend it."}
        </p>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            ref={cancelRef}
            type="button"
            data-testid="x-confirm-cancel"
            onClick={onCancel}
            className="rounded-[7px] border border-border-strong px-3.5 py-[7px] text-[14px] text-ink-muted hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="x-confirm-publish"
            disabled={busy || length === 0 || length > MAX_POST_CHARACTERS}
            onClick={onConfirm}
            className="rounded-[7px] border border-link bg-link/[0.14] px-3.5 py-[7px] text-[14px] text-ink disabled:opacity-40"
          >
            {busy ? "Sending…" : dryRun ? "Run it dry" : "Publish"}
          </button>
        </footer>
      </div>
    </div>
  );
}
