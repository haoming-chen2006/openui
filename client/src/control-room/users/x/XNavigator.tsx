/**
 * The X page, NAVIGATOR region.
 *
 * The navigator is not a second copy of the list. MAIN already shows every draft and every record;
 * what belongs here is the standing context a reader needs while looking at either — which account
 * these words would go out as, whether anything is actually sent, and how much is waiting.
 *
 * The unsettled count is the one number here that is a call to action. `in_flight` and `unknown`
 * both mean "a post may exist and this workspace does not know", and §3.13's rule is that a human
 * resolves that by reading the account, never by sending again. So it is surfaced where it cannot
 * be scrolled past, and it says what to do.
 */
import type { WorkspacePageProps } from "../../shell/contract";
import { pendingDrafts, useXState } from "./xStore";

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-[76px] shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-ghost">
        {label}
      </span>
      <span className="min-w-0 text-[13px] text-ink-muted">{value}</span>
    </div>
  );
}

function XNav(_props: WorkspacePageProps) {
  const state = useXState();
  const waiting = pendingDrafts(state).length;
  const unsettled = state.records.filter(
    (r) => r.state === "in_flight" || r.state === "unknown",
  ).length;

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <div className="flex flex-col gap-1.5">
        <Line
          label="Account"
          value={
            state.status?.account
              ? `@${state.status.account.username}`
              : state.status?.configured === false
                ? "not configured"
                : state.status?.accountError
                  ? "could not be read"
                  : "…"
          }
        />
        <Line label="Mode" value={state.status?.dryRun === false ? "live" : "dry run"} />
        <Line label="Drafts" value={String(waiting)} />
        <Line label="Published" value={String(state.records.length)} />
      </div>

      {unsettled > 0 ? (
        <p
          data-testid="x-unsettled"
          className="rounded border border-status-waiting px-2.5 py-2 text-[12px] leading-snug text-status-waiting"
        >
          {unsettled} {unsettled === 1 ? "post is" : "posts are"} unresolved — the connection dropped
          before X answered. Read the account and check before sending anything again. Resending is
          how one post becomes two.
        </p>
      ) : null}

      <p className="text-[11px] leading-snug text-ink-ghost">
        {state.status?.dryRun === false
          ? "Confirming here posts publicly and permanently."
          : "X_DRY_RUN=1 is set on the server, so confirming here records everything and sends nothing."}
      </p>
    </div>
  );
}

export const XPageNavigator = (props: WorkspacePageProps) => <XNav {...props} />;
