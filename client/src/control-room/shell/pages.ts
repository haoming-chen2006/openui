/**
 * The page registry — OWNED BY 07-shell. Reconciliation edits ONLY this file (request R-4).
 *
 * The shell never imports a page module. It imports this one, so each sibling worktree's single
 * mount line lands in one file instead of eight worktrees editing one import block.
 *
 * Note what is deliberately absent: a `main` field holding an import of a path that does not exist
 * yet. That would fail the client typecheck in this worktree and in every worktree that merges
 * before its sibling. An optional field left undefined typechecks today, and costs one line at
 * reconciliation. Until then the slot renders the honest statement that the branch has not merged
 * — never an empty list, never a spinner, never a plausible-looking zero.
 */
import { useMemo } from "react";
import type { PageDescriptor, ToolsPanelComponent } from "./contract";
import { AGENTS_PAGE_SLOTS } from "../agents";
import { ToolsPanel } from "../tools";
import { AssetsInspector, AssetsNavigator, AssetsPage } from "../assets";
import {
  DesignDocumentInspector,
  DesignDocumentsNavigator,
  DesignDocumentsPage,
} from "../designdoc";
import { USERS_PAGE_SLOTS, X_PAGE_SLOTS, useXConfigured } from "../users";

export const PAGES: PageDescriptor[] = [
  { id: "agents", label: "Agents", segment: "agents", rank: "headline", builtBy: "01-agents", ...AGENTS_PAGE_SLOTS },
  {
    id: "assets",
    label: "Assets",
    segment: "assets",
    rank: "headline",
    builtBy: "02-assets",
    main: AssetsPage,
    navigator: AssetsNavigator,
    inspector: AssetsInspector,
  },
  {
    id: "designdocs",
    label: "Design Documents",
    segment: "designdocs",
    rank: "headline",
    builtBy: "03-design-docs",
    main: DesignDocumentsPage,
    navigator: DesignDocumentsNavigator,
    inspector: DesignDocumentInspector,
  },
  // 08-users-x, mounted. The row keeps its id, label, segment and rank — those are the shell's —
  // and gains only the three components, which is why the page exports them as one object.
  { id: "users", label: "Users", segment: "users", rank: "secondary", builtBy: "08-users-x", ...USERS_PAGE_SLOTS },
  // 08-users-x stage 14, mounted. Unlike every other row, this one is not always shown — see
  // `useVisiblePages` below. The registry still declares it, because the page IS built; what is
  // conditional is whether this workspace has an X application to point it at.
  { id: "x", label: "X", segment: "x", rank: "secondary", builtBy: "08-users-x", ...X_PAGE_SLOTS },
];

/**
 * The rows this workspace should actually show — XAP-008.
 *
 * "With no X credentials configured, the page does not appear in the navigation at all — not
 * disabled, not greyed." That is a runtime fact about the server, and `PAGES` is a module constant,
 * so the filter cannot live in the array. It lives here, and the shell reads pages through it.
 *
 * `useXConfigured()` starts false and is revealed once `GET /api/x/status` confirms. Hidden→shown
 * rather than shown→hidden is deliberate: the other order would put the X tab in the navigation of
 * every workspace that has no X application, briefly, on every single load.
 */
export function useVisiblePages(): PageDescriptor[] {
  const xConfigured = useXConfigured();
  return useMemo(() => PAGES.filter((p) => p.id !== "x" || xConfigured), [xConfigured]);
}

/**
 * The Tools panel, wired by reconciliation as pivot/tools asked.
 *
 * The panel renders only the body: the scrim, the Esc handler, the header and the close button are
 * the shell's, and the panel does not duplicate them.
 */
export const TOOLS_PANEL: ToolsPanelComponent | undefined = ToolsPanel;
