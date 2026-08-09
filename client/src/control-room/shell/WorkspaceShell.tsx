/**
 * The frame — loops/07-shell.md §3.1.
 *
 * Three regions on every page: NAVIGATOR, MAIN, INSPECTOR, with a toolbar above them. It owns no
 * domain logic. The pages arrive through `./pages`, which reconciliation edits and this file never
 * imports around.
 *
 * The shell lives here rather than in `ControlRoomApp.tsx` because that file is hot and shared by
 * eight worktrees; it becomes a five-line re-export at reconciliation (request R-3).
 *
 * **Measurements come from the owner's two wireframes**, assets-page.html and
 * design-document.html, which agree on the chrome to the pixel: a 44px toolbar with 14px padding
 * and a 14px gap, hairline rules, a 15/14/13/11/10 type scale, mono numerals, 24px toolbar
 * controls at radius 5, and headline pages set apart from secondary ones by a rule. Where the
 * wireframes disagree with each other or with §3.1, the decisions are recorded in
 * loops/handoff/pivot-shell.md rather than taken silently.
 */
import { useEffect, useState } from "react";
import { TOOLS_SECTIONS, TOOLS_SECTION_LABEL } from "./contract";
import type { PageDescriptor, ToolsSection, WorkspacePageProps } from "./contract";
import { NotMergedYet } from "./NotMergedYet";
import { SlotBoundary } from "./SlotBoundary";
import { PAGES, TOOLS_PANEL, useVisiblePages } from "./pages";
import { INSPECTOR, NAVIGATOR, RAIL, layout, useRegion } from "./regions";
import { useWorkspaceRoute } from "./router";
import { useTheme } from "./theme";
import { useShellData, type ShellNotification, type ShellSpend } from "./useShellData";

/** Section label: mono, small, tracked, quiet. Both wireframes use it for every region heading. */
function SectionLabel({ children }: { children: string }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-ghost">{children}</div>
  );
}

/**
 * The running spend, as all four mockups draw it: a mono `PROJECT SPEND`, the figure, and a 96px
 * meter against the budget.
 *
 * Three outcomes, because two of them are different absences and only one is a number:
 *
 *   —        nothing has been charged to this project. Not $0.00, which reads as "we counted".
 *   unknown  money was spent and nothing could price it.
 *   $x / $y  a real figure. When part of the total is unpriced it says so in the title, because a
 *            partial sum shown as a total under-reports a bill that runs while nobody watches.
 *
 * assets-page.html leaves the figure bare and design-document.html labels it; labelled won. It is
 * the one number §3.1 puts on every page precisely because a 60-second generated experience costs
 * ~$5.52 in media alone, and "PROJECT SPEND unknown" says what is unknown where a bare "unknown"
 * does not.
 */
function Spend({ spend }: { spend: ShellSpend }) {
  const partial =
    spend.state === "priced" && spend.unpriced > 0
      ? ` ${spend.unpriced} charge${spend.unpriced === 1 ? "" : "s"} could not be priced, so this is a floor rather than the total.`
      : "";
  return (
    <div data-testid="toolbar-spend" className="flex items-baseline gap-[7px]">
      <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-ink-ghost">
        Project spend
      </span>
      {spend.state === "priced" ? (
        <>
          <span
            className="font-mono text-[11px] text-ink-muted"
            title={`Charged so far.${partial}`}
          >
            ${spend.usd.toFixed(2)}
            {spend.budgetUsd ? ` / $${spend.budgetUsd.toFixed(2)}` : ""}
            {partial ? "+" : ""}
          </span>
          {spend.budgetUsd ? (
            <span className="h-[7px] w-24 self-center overflow-hidden rounded border border-border-strong">
              <span
                className="block h-full bg-link"
                style={{ width: `${Math.min(100, (spend.usd / spend.budgetUsd) * 100)}%` }}
              />
            </span>
          ) : null}
        </>
      ) : spend.state === "unpriced" ? (
        <span
          className="font-mono text-[11px] text-ink-faint"
          title={`${spend.charges} charge${spend.charges === 1 ? " was" : "s were"} recorded and no rate could price ${spend.charges === 1 ? "it" : "them"}, so the total is not known.`}
        >
          unknown
        </span>
      ) : (
        <span
          className="font-mono text-[11px] text-ink-ghost"
          title="Nothing has been charged to this project yet."
        >
          —
        </span>
      )}
    </div>
  );
}

/**
 * One notification surface, not six.
 *
 * Today's first screen on a fresh install stacks six full-width banners of 11px red text. These are
 * rows in one dismissible stack, one line of plain language each, so two simultaneous alerts are
 * two rows rather than two strips.
 */
export function Notifications({ items }: { items: ShellNotification[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const live = items.filter((n) => !dismissed.includes(n.id));
  if (live.length === 0) return null;
  return (
    <div data-testid="notifications" role="status" className="border-b border-border">
      {live.map((n) => (
        <div
          key={n.id}
          data-testid={`notification-${n.id}`}
          className="flex items-center gap-3 px-3.5 py-2 text-[13px] text-ink-muted"
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${
              n.tone === "error" ? "bg-status-failed" : "bg-status-waiting"
            }`}
          />
          {/* The tone is also stated in text: colour is never the only signal. */}
          <span className="sr-only">{n.tone === "error" ? "Error:" : "Warning:"}</span>
          <span className="min-w-0 flex-1">{n.message}</span>
          <button
            type="button"
            data-testid={`notification-${n.id}-dismiss`}
            onClick={() => setDismissed((d) => [...d, n.id])}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-ink-faint hover:bg-surface-hover"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}

/** A draggable rule between two regions. Keyboard-resizable, because a drag handle is not enough. */
function ResizeHandle({
  side,
  onResize,
  onToggle,
  width,
}: {
  side: "left" | "right";
  onResize: (px: number) => void;
  onToggle: () => void;
  width: number;
}) {
  const start = (event: React.MouseEvent) => {
    event.preventDefault();
    const originX = event.clientX;
    const originWidth = width;
    const move = (e: MouseEvent) => {
      const delta = side === "left" ? e.clientX - originX : originX - e.clientX;
      onResize(originWidth + delta);
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      data-testid={`resize-${side}`}
      onMouseDown={start}
      onDoubleClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(width + (side === "left" ? -16 : 16));
        if (e.key === "ArrowRight") onResize(width + (side === "left" ? 16 : -16));
      }}
      className="w-px shrink-0 cursor-col-resize bg-border hover:bg-border-strong"
    />
  );
}

/**
 * The page strip — a horizontal row under the toolbar, above the three regions.
 *
 * **All four mockups draw it this way and none of them puts the pages in the navigator.** It used
 * to live in the navigator on the strength of one line in the published contract
 * (`PageDescriptor.navigator` renders "beneath the page selector"), which is a statement about
 * ordering within a region and was read as a statement about which region. The cost of the wrong
 * reading was structural rather than cosmetic: the navigator is the page's own list — assets,
 * documents, people — and putting a second, global list above it meant every page opened with two
 * lists stacked on top of each other, one of which never changed.
 *
 * The treatment is the mockups': three headline pages as bordered pills carrying a small square,
 * a rule, then two secondary pages as quieter text, then Tools pushed to the far end. Secondary
 * means the product is coherent without those pages, not that they are half-built — and a
 * secondary page that IS selected takes the pill too (users-page.html), because "you are here"
 * outranks rank.
 */
function PageStrip({
  active,
  onPick,
  toolsOpen,
  onTools,
}: {
  active: string;
  onPick: (page: PageDescriptor) => void;
  toolsOpen: boolean;
  onTools: () => void;
}) {
  // Through `useVisiblePages`, not `PAGES`: an optional page that this workspace has not
  // configured is absent from the navigation rather than shown disabled (XAP-008).
  const visible = useVisiblePages();
  const headline = visible.filter((p) => p.rank === "headline");
  const secondary = visible.filter((p) => p.rank === "secondary");

  const tab = (page: PageDescriptor) => {
    const isActive = page.id === active;
    const selected = "border border-link bg-link/[0.14] text-ink";
    return (
      <button
        key={page.id}
        type="button"
        data-testid={`page-${page.id}`}
        aria-current={isActive ? "page" : undefined}
        onClick={() => onPick(page)}
        title={`Go to ${page.label}`}
        className={
          page.rank === "headline"
            ? `flex items-center gap-2 rounded-[7px] px-4 py-[7px] text-[15px] ${
                isActive ? selected : "border border-border-strong text-ink-muted hover:bg-surface-hover"
              }`
            : isActive
              ? `rounded-[7px] px-3.5 py-[7px] text-[14px] ${selected}`
              : "rounded-[7px] px-3 py-[7px] text-[14px] text-ink-faint hover:bg-surface-hover"
        }
      >
        {/* The mockups mark a headline page with a small square; a secondary page carries none. */}
        {page.rank === "headline" ? (
          <span
            aria-hidden="true"
            className={`h-[14px] w-[14px] rounded-[3px] border ${
              isActive ? "border-ink/60" : "border-border-strong"
            }`}
          />
        ) : null}
        {page.label}
      </button>
    );
  };

  return (
    <nav
      data-testid="page-selector"
      aria-label="Pages"
      className="flex shrink-0 items-center gap-2 border-b border-border px-3.5 py-2"
    >
      {headline.map(tab)}
      <span aria-hidden="true" data-testid="page-strip-divider" className="mx-1.5 h-[22px] w-px bg-border-strong" />
      {secondary.map(tab)}
      <div className="flex-1" />
      <button
        type="button"
        data-testid="tools-open"
        onClick={onTools}
        aria-expanded={toolsOpen}
        title="Prompts and skills, over whatever page you are on"
        className="flex items-center gap-2 rounded-[7px] border border-border-strong px-3.5 py-[7px] text-[14px] text-ink-muted hover:bg-surface-hover"
      >
        Tools
        <span aria-hidden="true" className="font-mono text-[10px] text-ink-ghost">⌘T</span>
      </button>
    </nav>
  );
}

/**
 * The two small squares the toolbar opens with in every mockup.
 *
 * Drawn there as decoration; built here as the region toggles, because that is the only thing two
 * squares at the left of a three-region window can honestly mean, and the regions were otherwise
 * collapsible only by double-clicking a 1px rule nobody finds.
 */
function RegionToggles({
  navigator,
  inspector,
}: {
  navigator: { collapsed: boolean; toggle(): void };
  inspector: { collapsed: boolean; toggle(): void };
}) {
  const square = (side: "navigator" | "inspector", region: { collapsed: boolean; toggle(): void }) => (
    <button
      key={side}
      type="button"
      data-testid={`toggle-${side}`}
      onClick={region.toggle}
      aria-pressed={!region.collapsed}
      title={`${region.collapsed ? "Show" : "Hide"} the ${side}`}
      className={`h-[13px] w-[13px] rounded-[3px] border ${
        region.collapsed ? "border-border-strong" : "border-border-strong bg-ink-ghost"
      }`}
    />
  );
  return (
    <div className="flex gap-[5px]">
      {square("navigator", navigator)}
      {square("inspector", inspector)}
    </div>
  );
}

/**
 * A collapsed region, reduced to a rail rather than to nothing.
 *
 * Both wireframes take this shape for the third region: a 46px strip with a chevron back to the
 * expanded state and a vertical label naming what is folded away. design-document.html captions
 * it "the document gets the full width; the rail keeps presence visible" — the point of the rail
 * is that you can still see something is in there.
 */
function CollapsedRail({
  side,
  label,
  onExpand,
}: {
  side: "navigator" | "inspector";
  label: string;
  onExpand: () => void;
}) {
  return (
    <aside
      data-testid={`${side}-rail`}
      aria-label={`${label} (collapsed)`}
      style={{ width: RAIL }}
      className={`flex shrink-0 flex-col items-center gap-3.5 py-3 ${
        side === "navigator" ? "border-r" : "border-l"
      } border-border`}
    >
      <button
        type="button"
        data-testid={`${side}-expand`}
        onClick={onExpand}
        aria-label={`Expand the ${label.toLowerCase()}`}
        className="grid h-7 w-7 place-items-center rounded-md border border-border text-[13px] text-ink-faint hover:bg-surface-hover"
      >
        {side === "navigator" ? "›" : "‹"}
      </button>
      <span
        className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-ghost"
        style={{ writingMode: "vertical-rl" }}
      >
        {label}
      </span>
    </aside>
  );
}

/**
 * The Tools overlay — loops/07-shell.md §3.2.
 *
 * It overlays MAIN rather than replacing it because its whole purpose is to be applied to the
 * thing you are currently looking at; a panel you must navigate away to reach cannot be. Xcode's
 * Library is the same idea for the same reason.
 *
 * **This worktree owns the mount, the scrim, the Esc key and the route. 06-tools-cost owns
 * everything inside.** The line is not negotiable in either direction: if the panel renders its
 * own scrim or its own Esc handler, two dismissal paths fight and the query parameter
 * desynchronises from the DOM.
 *
 * It is a query parameter and not a path segment so that opening it does not lose the page
 * underneath — that is the entire argument for it being an overlay.
 */
function ToolsOverlay({
  section,
  projectId,
  onOpenSection,
  onClose,
}: {
  section: ToolsSection;
  projectId: string;
  onOpenSection: (section: ToolsSection) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const Panel = TOOLS_PANEL;

  return (
    <div data-testid="tools-overlay" className="absolute inset-0 z-50 flex flex-col">
      {/* The scrim dims MAIN without unmounting it: the page underneath is still there, and
          clicking the scrim is the same dismissal as Esc. */}
      <button
        type="button"
        data-testid="tools-scrim"
        aria-label="Close the Tools panel"
        onClick={onClose}
        // Two alphas, not one. 50% black is right over near-black — it reads as a dim — and
        // wrong over near-white, where it renders a flat mid-grey that looks like a component
        // that failed to load rather than a page that is still there underneath. Caught by
        // opening the overlay in the light theme and looking at it.
        className="absolute inset-0 bg-scrim/20 dark:bg-scrim/50"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Tools"
        data-testid="tools-panel"
        className="relative mt-auto max-h-[70%] overflow-auto border-t border-border bg-surface"
      >
        <header className="flex items-center gap-3 border-b border-border px-3.5 py-2">
          <SectionLabel>Tools</SectionLabel>
          {/* The section was a label, so the panel showed whichever one the URL happened to say
              and there was no way to reach the other. Skills existed, were built, and were
              unreachable — the toolbar opens `prompts` and nothing anywhere wrote `skills`.

              It belongs here rather than inside the panel because the section is ROUTE state and
              this shell owns the route; the panel renders whichever one it is handed. */}
          <nav aria-label="Tools sections" className="flex items-center gap-1">
            {TOOLS_SECTIONS.map((id) => (
              <button
                key={id}
                type="button"
                data-testid={`tools-section-${id}`}
                aria-current={id === section ? "page" : undefined}
                onClick={() => onOpenSection(id)}
                className={`rounded border px-2 py-0.5 text-[12px] transition-colors ${
                  id === section
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-transparent text-ink-faint hover:bg-surface-hover hover:text-ink-muted"
                }`}
              >
                {TOOLS_SECTION_LABEL[id]}
              </button>
            ))}
          </nav>
          <div className="flex-1" />
          <button
            type="button"
            data-testid="tools-close"
            onClick={onClose}
            aria-label="Close the Tools panel"
            className="rounded border border-border px-2 py-0.5 text-[11px] text-ink-faint hover:bg-surface-hover"
          >
            Esc
          </button>
        </header>
        {Panel ? (
          <Panel projectId={projectId} section={section} onClose={onClose} />
        ) : (
          <NotMergedYet what="The Tools panel" branch="06-tools-cost" />
        )}
      </section>
    </div>
  );
}

/** Render a page's slot, or state that the branch which builds it has not merged. */
function Slot({
  component,
  page,
  what,
  props,
}: {
  component: PageDescriptor["main"];
  page: PageDescriptor;
  what: string;
  props: WorkspacePageProps;
}) {
  if (!component) return <NotMergedYet what={what} branch={page.builtBy} />;
  // `<Component {...props} />`, never `component(props)`.
  //
  // Calling it runs its body inside THIS component's render, so its hooks join the shell's own hook
  // list. Switching from a page whose slot uses no hooks to one that does then changes the shell's
  // hook count between two renders, React throws, and the whole tree unmounts — the page goes blank
  // and only a reload brings it back, because a fresh mount starts from a consistent list. That was
  // the "pages blank when I switch" bug, and it was in all three slots.
  const Component = component;
  return (
    <SlotBoundary what={what}>
      <Component {...props} />
    </SlotBoundary>
  );
}

/**
 * The `?` both wireframes draw beside the theme control, and the last thing missing from the
 * toolbar they specify.
 *
 * It says the four things this shell can state without asking anything: what the three regions
 * are, the one shortcut, the rule every page is built on, and that nothing about identity is
 * enforced. All four are facts about this product rather than documentation kept somewhere else,
 * which is what stops a help panel going stale the week after it is written.
 */
function Help() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        data-testid="help-open"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="What this workspace is"
        title="What this workspace is"
        className="grid h-6 w-6 place-items-center rounded-[5px] border border-border text-[13px] text-ink-faint hover:bg-surface-hover"
      >
        ?
      </button>
      {open ? (
        <div
          data-testid="help-panel"
          role="dialog"
          aria-label="What this workspace is"
          className="absolute right-0 top-9 z-20 flex w-[320px] flex-col gap-2 rounded-lg border border-border-strong bg-surface-active p-3 text-[13px] leading-snug text-ink-muted shadow-panel"
        >
          <p>
            Three regions on every page: the list on the left, the work in the middle, the
            properties of whatever is selected on the right. Drag the edges; the widths are
            remembered.
          </p>
          <p>
            <span className="font-mono text-[11px] text-ink">⌘T</span> opens Tools over any page
            without losing it. Esc closes it.
          </p>
          <p>An agent can only change things inside its own area.</p>
          <p className="text-ink-faint">
            Nobody signs in, so nothing about who may do what is enforced yet. The Users page says
            what that means.
          </p>
          <button
            type="button"
            data-testid="help-close"
            onClick={() => setOpen(false)}
            title="Close"
            className="self-start rounded border border-border px-2 py-0.5 text-[12px] text-ink-faint hover:bg-surface-hover"
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceShell() {
  const { route, go, select, openTools, closeTools } = useWorkspaceRoute();
  const { theme, toggle } = useTheme();
  const data = useShellData();
  const navigator = useRegion(NAVIGATOR.key);
  const inspector = useRegion(INSPECTOR.key);

  const [available, setAvailable] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = () => setAvailable(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Cmd/Ctrl-T opens the Tools overlay, the shortcut both wireframes print on the Tools control.
  // Esc lives inside the overlay, so there is exactly one dismissal path.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "t" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        openTools("prompts");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openTools]);

  const widths = layout(available, navigator, inspector);
  // Resolved against the VISIBLE pages, so a deep link to a page this workspace has not configured
  // lands on the first page rather than rendering a surface XAP-008 says does not exist here. The
  // fallback stays `PAGES[0]`, which is always visible — a filter can never empty this list.
  const visiblePages = useVisiblePages();
  const page = visiblePages.find((p) => p.id === route.page) ?? PAGES[0];
  const project = data.activeProject;

  // projectId is never empty: a workspace with no project gets the shell's own state, not a page
  // with a blank id. Pages therefore need no "no project" branch.
  const pageProps: WorkspacePageProps = {
    projectId: project?.id ?? "",
    selectionId: route.selectionId,
    onSelect: select,
  };

  return (
    <div data-testid="workspace-shell" className="flex h-screen w-screen flex-col bg-canvas text-ink">
      <header
        data-testid="toolbar"
        className="flex h-11 shrink-0 items-center gap-3.5 border-b border-border px-3.5 text-[15px]"
      >
        <RegionToggles navigator={navigator} inspector={inspector} />
        {/*
          The project, as a bordered pill with a ▾ — the shape all four mockups draw, and a real
          switcher underneath it. The shell used to select the oldest project on the machine with
          no way to change that, so a workspace with twenty-three projects could reach exactly one
          of them and creating a new one looked like it had failed. Selection lives in the URL, so
          this is a link, not state. With one project there is nothing to switch to, so the pill
          carries no ▾ and no control that does nothing.
        */}
        <div
          data-testid="toolbar-project"
          className="relative flex min-w-0 items-center gap-2 rounded-[7px] border border-border-strong px-2.5 py-[5px]"
        >
          <span className="min-w-0 truncate text-ink">
            {project ? project.name : data.loading ? "" : "No project yet"}
          </span>
          {data.projects.length > 1 ? (
            <>
              <span aria-hidden="true" className="text-[12px] text-ink-faint">▾</span>
              <select
                data-testid="project-switcher"
                aria-label="Switch project"
                value={project?.id ?? ""}
                onChange={(e) => {
                  const url = new URL(location.href);
                  url.searchParams.set("project", e.target.value);
                  location.assign(url.toString());
                }}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
        <div className="flex-1" />
        <Spend spend={data.spend} />
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        <Help />
        <button
          type="button"
          data-testid="theme-toggle"
          onClick={toggle}
          aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
          className="grid h-6 w-6 place-items-center rounded-[5px] border border-border text-[13px] text-ink-faint hover:bg-surface-hover"
        >
          {theme === "dark" ? "☾" : "☀"}
        </button>
      </header>

      <PageStrip
        active={page.id}
        onPick={(p) => go(p.id)}
        toolsOpen={route.tools !== undefined}
        onTools={() => openTools("prompts")}
      />

      <Notifications items={data.notifications} />

      <div className="flex min-h-0 flex-1">
        {navigator.collapsed ? (
          <CollapsedRail side="navigator" label="Navigator" onExpand={navigator.toggle} />
        ) : (
          <aside
            data-testid="navigator"
            aria-label="Navigator"
            style={{ width: widths.navigator }}
            className="flex shrink-0 flex-col gap-2 overflow-y-auto px-2.5 py-3"
          >
            {/*
              The page's own list and nothing above it. Every mockup's navigator opens with that
              page's search box — "Search agents", "Search design documents", "Search people" — so
              a heading naming the page you just clicked is a row of chrome between the user and
              the first control. The label survives only where there is no list to head.
            */}
            {page.navigator ? (
              // Rendered as an element, not called — see Slot. A navigator with hooks called inline
              // would put them on the shell's hook list and blank the page on the next switch.
              <Slot component={page.navigator} page={page} what={`${page.label}'s list`} props={pageProps} />
            ) : (
              <>
                <SectionLabel>{page.label}</SectionLabel>
                <p className="text-[13px] text-ink-faint">
                  This page's list arrives with {page.builtBy ?? "its branch"}.
                </p>
              </>
            )}
          </aside>
        )}

        <ResizeHandle
          side="left"
          width={navigator.width}
          onResize={navigator.setWidth}
          onToggle={navigator.toggle}
        />

        <main data-testid="main" className="relative min-w-0 flex-1 overflow-auto">
          {/*
            The page renders whether or not a project exists, and decides its own empty state.

            The shell used to substitute the front door for MAIN whenever there was no project.
            After a purge that meant every tab showed the same screen — clicking Assets, Users or X
            changed the navigator and nothing else, so the tabs read as broken. A shell that
            overrides every page with one page is a shell that has stopped being a shell.

            AGENTS and DESIGN DOCUMENTS show the paste box themselves, which is where starting a
            project belongs. The others say what they hold, which with no project is nothing.
          */}
          <Slot component={page.main} page={page} what={page.label} props={pageProps} />
          {route.tools ? (
            <ToolsOverlay
              section={route.tools}
              projectId={pageProps.projectId}
              onOpenSection={openTools}
              onClose={closeTools}
            />
          ) : null}
        </main>

        <ResizeHandle
          side="right"
          width={inspector.width}
          onResize={inspector.setWidth}
          onToggle={inspector.toggle}
        />

        {inspector.collapsed ? (
          <CollapsedRail side="inspector" label="Inspector" onExpand={inspector.toggle} />
        ) : (
          <aside
            data-testid="inspector"
            aria-label="Inspector"
            style={{ width: widths.inspector }}
            className="flex shrink-0 flex-col gap-3.5 overflow-y-auto px-3.5 py-4"
          >
            {page.inspector ? (
              <Slot component={page.inspector} page={page} what={`${page.label}'s inspector`} props={pageProps} />
            ) : (
              <>
                <SectionLabel>Inspector</SectionLabel>
                <p className="text-[13px] text-ink-faint">
                  Properties of whatever is selected in the middle. This page's inspector arrives
                  with {page.builtBy ?? "its branch"}.
                </p>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
