import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { workspaceUrl } from "./contract";
import { PAGES } from "./pages";
import { navigate } from "./router";
import { Notifications, WorkspaceShell } from "./WorkspaceShell";
import { NAVIGATOR } from "./regions";
// Through the barrel, never `../users/x/...`: SHELL-017 forbids the shell reaching into a page
// module's interior, and a test file in this directory is subject to the same rule as the shell.
import { setXConfiguredForTest } from "../users";
import { NotMergedYet } from "./NotMergedYet";

const PROJECT = { id: "proj_1", name: "Aeris Chairs — Q3 sales push" };

/** The endpoints the shell reads, all of which exist on the merge base. */
function stubServer(overrides: { projects?: unknown; grok?: unknown; spend?: unknown } = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    // Checked before /api/projects, which it is a path under.
    const body = url.includes("/spend")
      ? (overrides.spend ?? { charges: 0, unpriced: 0, pricedUsd: 0 })
      : url.includes("/api/projects")
      ? (overrides.projects ?? [PROJECT])
      : url.includes("/api/grok/status")
        ? (overrides.grok ?? { installed: true })
        // The Tools panel lists skills, prompts and workflows. An object here is not an empty list:
        // the panel mapped over it and the region never resolved, which read as a timeout rather
        // than as the type error it was.
        : url.includes("/api/library")
          ? []
          : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

async function mount() {
  const result = render(<WorkspaceShell />);
  // The shell resolves its project before a page slot can be given a non-empty projectId.
  await waitFor(() => expect(screen.getByTestId("toolbar-project").textContent).not.toBe(""));
  return result;
}

/**
 * happy-dom starts at `about:blank`, where `location.pathname` is the string "blank" and a
 * relative `history.replaceState` cannot resolve. Every URL assertion below silently passed
 * against the wrong page until this was added — the shell read no path, fell back to the default,
 * and the tests agreed with it. Giving the document a real origin first is what makes the routing
 * assertions mean anything.
 *
 * Done here rather than in `client/happydom.ts`, which is an unassigned shared file and therefore
 * hot; the finding is filed for the other worktrees in loops/handoff/pivot-shell.md.
 */
function atUrl(path: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(
    `http://localhost${path}`,
  );
}

beforeEach(() => {
  localStorage.clear();
  atUrl("/designdocs");
  stubServer();
  // 08-users-x stage 14: the X row is the one page whose presence is a runtime fact rather than a
  // merge fact (XAP-008). These tests are about the five-page shell, so they state that this
  // workspace has an X application; the case where it does not has its own test below.
  setXConfiguredForTest(true);
});
afterEach(() => {
  cleanup();
  setXConfiguredForTest(null);
});

describe("the three regions", () => {
  test("navigator, main and inspector render on every page", async () => {
    for (const page of PAGES) {
      atUrl(workspaceUrl(page.id));
      await mount();
      expect(screen.getByTestId("navigator")).toBeDefined();
      expect(screen.getByTestId("main")).toBeDefined();
      expect(screen.getByTestId("inspector")).toBeDefined();
      cleanup();
    }
  });

  test("the shell's own inspector content offers no way to change what MAIN displays", async () => {
    await mount();
    // An inspector that can change MAIN is a second navigator, and the user loses their place.
    //
    // Scoped to the shell's OWN content on purpose. Once a sibling mounts a real inspector this
    // element will contain that page's markup, and a blanket "no buttons in the inspector" rule
    // asserted here would fail on their branch for a judgement made on this one. The rule for
    // page-supplied inspectors is stated in loops/handoff/pivot-shell.md, where they can read it.
    //
    // 08-users-x: that is exactly what happened — USERS now supplies an inspector, and the
    // blanket `PAGES.every(p => p.inspector === undefined)` that stood here failed on this branch
    // for a judgement made on 07-shell's. Narrowed to the page actually mounted, which is what the
    // paragraph above asks for and what keeps the two assertions below meaningful.
    //
    // Reconciliation: narrowing it to DEFAULT_PAGE was not narrow enough either. 03-design-docs
    // supplies an inspector and DEFAULT_PAGE is `designdocs`, so the assertion failed for the same
    // reason one merge later. What this test is actually about is the shell's OWN fallback content,
    // so it now mounts a page that supplies no inspector and asserts there. When every page supplies
    // one, `bare` is undefined and the test says so rather than passing vacuously.
    // Stage 14 made `bare` undefined — X supplied the last missing inspector — and the paragraph
    // above anticipated it. So the runtime path runs while a page still lacks one, and the source
    // assertion below covers the fallback once none does. The rule being guarded never changed:
    // the shell's own inspector content is prose, and prose does not navigate.
    const bare = PAGES.find((p) => !p.inspector);
    if (bare) {
      cleanup();
      atUrl(workspaceUrl(bare.id));
      await mount();
      const inspector = screen.getByTestId("inspector");
      expect(inspector.querySelectorAll("button").length).toBe(0);
      expect(inspector.querySelectorAll("a").length).toBe(0);
      return;
    }

    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dir, "WorkspaceShell.tsx"), "utf8");
    const start = src.indexOf("{page.inspector ? (");
    expect(start).toBeGreaterThan(-1);
    const fallback = src.slice(start, src.indexOf("</aside>", start));
    expect(fallback).toContain("Properties of whatever is selected in the middle");
    expect(fallback).not.toContain("<button");
    expect(fallback).not.toContain("onClick");
    expect(fallback).not.toContain("<a ");
  });

  test("a side region collapses on a double-click and its width survives a remount", async () => {
    await mount();
    expect(screen.getByTestId("navigator")).toBeDefined();

    fireEvent.doubleClick(screen.getByTestId("resize-left"));
    await waitFor(() => expect(screen.queryByTestId("navigator")).toBeNull());
    // Collapsed is a rail, not nothing: the wireframes keep a strip with a way back.
    expect(screen.getByTestId("navigator-rail")).toBeDefined();
    expect(screen.getByTestId("navigator-expand")).toBeDefined();

    cleanup();
    await mount();
    // Reload: the collapse persisted, so the user does not have to re-collapse it every visit.
    expect(screen.queryByTestId("navigator")).toBeNull();
    expect(screen.getByTestId("navigator-rail")).toBeDefined();
  });

  test("the rail's own control expands the region again", async () => {
    await mount();
    fireEvent.doubleClick(screen.getByTestId("resize-left"));
    await waitFor(() => expect(screen.getByTestId("navigator-rail")).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByTestId("navigator-expand"));
    });
    expect(screen.getByTestId("navigator")).toBeDefined();
    expect(screen.queryByTestId("navigator-rail")).toBeNull();
  });

  test("a side region resizes by keyboard, and the new width persists", async () => {
    await mount();
    expect(screen.getByTestId("navigator").style.width).toBe(`${NAVIGATOR.initial}px`);

    fireEvent.keyDown(screen.getByTestId("resize-left"), { key: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getByTestId("navigator").style.width).toBe(`${NAVIGATOR.initial + 16}px`),
    );

    cleanup();
    await mount();
    expect(screen.getByTestId("navigator").style.width).toBe(`${NAVIGATOR.initial + 16}px`);
  });
});

describe("the page strip names the places", () => {
  test("three headline pages, a rule, two secondary ones, then Tools", async () => {
    await mount();
    const selector = screen.getByTestId("page-selector");
    const order = [...selector.children].map((el) => el.getAttribute("data-testid") ?? "");
    expect(order).toEqual([
      "page-agents",
      "page-assets",
      "page-designdocs",
      "page-strip-divider",
      "page-users",
      "page-x",
      // The spacer that pushes Tools to the far end, as every mockup draws it.
      "",
      "tools-open",
    ]);
  });

  test("a workspace with no X application has no X tab — not a disabled one (XAP-008)", async () => {
    setXConfiguredForTest(false);
    await mount();
    const order = [...screen.getByTestId("page-selector").children].map(
      (el) => el.getAttribute("data-testid") ?? "",
    );
    // Absent, not greyed and not tooltipped. The four other pages are untouched, so this is the
    // optional page being optional rather than the strip failing to render.
    expect(order).not.toContain("page-x");
    expect(order).toContain("page-users");
    expect(screen.queryByTestId("page-x")).toBeNull();
  });

  test("a deep link to X in that workspace lands somewhere real, not on a page that is absent", async () => {
    setXConfiguredForTest(false);
    atUrl(workspaceUrl("x"));
    await mount();
    // The first page, which is always visible. Rendering the X surface for a URL the navigation
    // does not offer would be the same violation reached by typing instead of clicking.
    expect(screen.getByTestId("page-agents").getAttribute("aria-current")).toBe("page");
  });

  test("the strip is chrome, above the regions and outside the navigator", async () => {
    // All four mockups draw a horizontal row under the toolbar. It used to sit inside the
    // navigator, which meant every page opened with a global list stacked on top of its own.
    await mount();
    const strip = screen.getByTestId("page-selector");
    expect(screen.getByTestId("navigator").contains(strip)).toBe(false);
    expect(screen.getByTestId("main").contains(strip)).toBe(false);
  });

  test("every page label is plain language, and none is an id", async () => {
    await mount();
    for (const page of PAGES) {
      expect(screen.getByTestId(`page-${page.id}`).textContent).toBe(page.label);
    }
    expect(screen.getByTestId("page-designdocs").textContent).toBe("Design Documents");
  });

  test("nothing else in the shell navigates between pages", async () => {
    await mount();
    // Today's shell has a six-tab strip inside MAIN as well as a left rail. MAIN holds no page
    // switcher at all: the strip is the only surface that changes which page you are on.
    const main = screen.getByTestId("main");
    for (const page of PAGES) {
      expect(main.querySelector(`[data-testid="page-${page.id}"]`)).toBeNull();
    }
  });
});

describe("location is in the URL", () => {
  test("clicking a page writes its url and renders that page", async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId("page-assets"));
    });
    expect(location.pathname).toBe("/assets");
    expect(screen.getByTestId("page-assets").getAttribute("aria-current")).toBe("page");
  });

  test("a url restores the page it names, on a cold mount", async () => {
    atUrl(workspaceUrl("users"));
    await mount();
    expect(screen.getByTestId("page-users").getAttribute("aria-current")).toBe("page");
  });

  test("the back button moves between pages", async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId("page-assets"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("page-agents"));
    });
    expect(screen.getByTestId("page-agents").getAttribute("aria-current")).toBe("page");

    // history.back() is asynchronous and happy-dom does not schedule popstate the way a browser
    // does, so the pop is driven directly. What this proves is the shell's half of the contract:
    // it re-reads location on popstate rather than holding its own copy of "which page am I on".
    await act(async () => {
      history.replaceState(null, "", workspaceUrl("assets"));
      window.dispatchEvent(new Event("popstate"));
    });
    expect(screen.getByTestId("page-assets").getAttribute("aria-current")).toBe("page");
  });

  test("a programmatic navigation re-renders, because pushState does not fire popstate", async () => {
    await mount();
    await act(async () => {
      navigate(workspaceUrl("x"));
    });
    expect(screen.getByTestId("page-x").getAttribute("aria-current")).toBe("page");
  });
});

describe("an unmerged page is stated, never faked", () => {
  test("every slot says which branch builds it, and shows no empty list or spinner", async () => {
    // Only the pages that have not merged. 08-users-x narrowed this from `PAGES`: the rule is
    // "an UNMERGED page is stated, never faked", and once a page merges there is nothing left to
    // state about it. Iterating all five made the test assert that nothing had merged, which was
    // true on 07-shell's branch and is a fact about the calendar rather than about the shell.
    //
    // Stage 14 emptied this list — X was the last hole and the registry now has five `main`s — so
    // the loop below runs zero times and the guard that demanded at least one hole is gone. What
    // replaces it is the direct assertion underneath: the component still has to say the right
    // thing, or deleting it would leave nothing to notice.
    const unmerged = PAGES.filter((p) => !p.main);
    expect(unmerged.length).toBe(0);

    cleanup();
    render(<NotMergedYet what="The Example page" branch="09-example" />);
    const stated = screen.getByTestId("not-merged-yet");
    expect(stated.textContent).toContain("Nothing is mounted here yet");
    expect(stated.textContent).toContain("The Example page");
    expect(stated.textContent).toContain("09-example");
    // Provenance, never a merge status — 06-tools-cost had merged while this notice still claimed
    // otherwise, which is how the old wording was caught.
    expect(stated.textContent).not.toContain("has not merged yet");
    cleanup();

    for (const page of unmerged) {
      atUrl(workspaceUrl(page.id));
      await mount();
      const notice = screen.getByTestId("not-merged-yet");
      expect(notice.textContent).toContain(page.label);
      expect(notice.textContent).toContain(page.builtBy!);
      // States what the shell can observe — that nothing is mounted — and names the branch as
      // provenance. It must NOT assert a merge status: 06-tools-cost had merged while this notice
      // still said it had not, which is how the old wording was caught.
      expect(notice.textContent).toContain("Nothing is mounted here yet");
      expect(notice.textContent).not.toContain("has not merged yet");
      cleanup();
    }
  });

  test("a merged page renders itself, and the notice is gone rather than behind it", async () => {
    // The counterpart the test above needs to still mean something. Without it, deleting the
    // NotMergedYet component entirely would leave the suite green for every merged page.
    const merged = PAGES.filter((p) => p.main);
    for (const page of merged) {
      atUrl(workspaceUrl(page.id));
      await mount();
      expect(screen.queryByTestId("not-merged-yet")).toBeNull();
      expect(screen.getByTestId("main").textContent?.length).toBeGreaterThan(0);
      cleanup();
    }
  });

  test("the shell imports no sibling page module", async () => {
    // SHELL-017: on this branch alone, with nothing merged, the shell still builds and renders.
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const offenders: string[] = [];
    for (const file of readdirSync(import.meta.dir).filter((f) => /\.tsx?$/.test(f))) {
      const text = readFileSync(join(import.meta.dir, file), "utf8");
      for (const m of text.matchAll(/from\s+"\.\.\/(agents|assets|designdoc|software|tools|users)\//g)) {
        offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("one notification surface, not six", () => {
  test("two simultaneous alerts are two rows in one surface, not two full-width strips", () => {
    // Driven directly rather than through the shell, because the shell has exactly one real alert
    // source today (Grok detection) and a test named "two alerts" that only ever renders one
    // proves nothing about the clause it claims to cover. Today's shell stacks SIX banners here.
    render(
      <Notifications
        items={[
          { id: "a", tone: "error", message: "Grok is not installed, so agents cannot start." },
          { id: "b", tone: "warning", message: "This project has no design document yet." },
        ]}
      />,
    );
    const surfaces = screen.getAllByTestId("notifications");
    expect(surfaces.length).toBe(1);
    expect(surfaces[0].children.length).toBe(2);
    expect(screen.getByTestId("notification-a")).toBeDefined();
    expect(screen.getByTestId("notification-b")).toBeDefined();
  });

  test("dismissing one row leaves the other, and the surface, in place", () => {
    render(
      <Notifications
        items={[
          { id: "a", tone: "error", message: "First." },
          { id: "b", tone: "warning", message: "Second." },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("notification-a-dismiss"));
    expect(screen.queryByTestId("notification-a")).toBeNull();
    expect(screen.getByTestId("notification-b")).toBeDefined();
  });

  test("the surface disappears entirely once every row is dismissed", () => {
    render(<Notifications items={[{ id: "a", tone: "error", message: "Only one." }]} />);
    fireEvent.click(screen.getByTestId("notification-a-dismiss"));
    expect(screen.queryByTestId("notifications")).toBeNull();
  });

  test("a row states its tone in text as well as in colour", () => {
    render(<Notifications items={[{ id: "a", tone: "error", message: "Broken." }]} />);
    const row = screen.getByTestId("notification-a");
    expect(row.textContent).toContain("Error:");
    expect(row.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  test("the shell feeds its one real alert source into that surface", async () => {
    stubServer({ grok: { installed: false, setupMessage: "Grok is not installed." } });
    await mount();
    expect(await screen.findByTestId("notification-grok-missing")).toBeDefined();
  });

  test("no notification surface renders when there is nothing to say", async () => {
    await mount();
    expect(screen.queryByTestId("notifications")).toBeNull();
  });
});

describe("the toolbar", () => {
  test("opens with the region toggles and the project, as every mockup draws it", async () => {
    await mount();
    expect(screen.getByTestId("toolbar-project").textContent).toContain(PROJECT.name);
    // The two squares are the toggles. Drawn as decoration; a control that hides a region is the
    // only thing they can honestly be, and the rules are otherwise 1px targets.
    expect(screen.getByTestId("toggle-navigator")).toBeDefined();
    expect(screen.getByTestId("toggle-inspector")).toBeDefined();
    // Tools moved to the page strip, where all four mockups put it.
    expect(screen.getByTestId("toolbar").querySelector('[data-testid="tools-open"]')).toBeNull();
  });

  test("hiding a region from the toolbar leaves its rail, not a hole", async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle-inspector"));
    });
    expect(screen.queryByTestId("inspector")).toBeNull();
    expect(screen.getByTestId("inspector-rail")).toBeDefined();
  });

  test("no charges renders an em dash, never a fabricated $0.00", async () => {
    await mount();
    const spend = screen.getByTestId("toolbar-spend");
    // design-document.html labels the figure and assets-page.html does not. Labelled won, and the
    // label is what makes the two absences readable.
    expect(spend.textContent).toContain("Project spend");
    expect(spend.textContent).toContain("—");
    expect(spend.textContent).not.toContain("$0.00");
  });

  test("charges nothing could price render as unknown, never as a total", async () => {
    stubServer({ spend: { charges: 3, unpriced: 3, pricedUsd: 0 } });
    await mount();
    await waitFor(() =>
      expect(screen.getByTestId("toolbar-spend").textContent).toContain("unknown"),
    );
    expect(screen.getByTestId("toolbar-spend").textContent).not.toContain("$0.00");
  });

  test("a priced total renders against its budget, and says when it is only a floor", async () => {
    stubServer({ spend: { charges: 4, unpriced: 1, pricedUsd: 21, budgetUsd: 50 } });
    await mount();
    const spend = screen.getByTestId("toolbar-spend");
    await waitFor(() => expect(spend.textContent).toContain("$21.00 / $50.00"));
    // The + is the visible half of it; the title says how many charges are missing, because a
    // partial sum shown as a total under-reports a bill nobody is watching.
    expect(spend.textContent).toContain("+");
    expect(spend.querySelector("[title]")?.getAttribute("title")).toContain("could not be priced");
  });

  test("the theme control switches the document class with no reload, both ways", async () => {
    await mount();
    const root = document.documentElement;
    // The starting theme is whatever the environment resolves to — happy-dom answers the
    // prefers-color-scheme query, and asserting a hardcoded starting point made this test pass
    // for the wrong reason once already.
    const started = root.classList.contains("light") ? "light" : "dark";
    const other = started === "light" ? "dark" : "light";

    await act(async () => {
      fireEvent.click(screen.getByTestId("theme-toggle"));
    });
    expect(root.classList.contains(other)).toBe(true);
    expect(root.classList.contains(started)).toBe(false);
    expect(localStorage.getItem("grok-workspace-theme")).toBe(other);

    await act(async () => {
      fireEvent.click(screen.getByTestId("theme-toggle"));
    });
    expect(root.classList.contains(started)).toBe(true);
    expect(localStorage.getItem("grok-workspace-theme")).toBe(started);
  });

  test("a stored choice wins over the OS preference in both directions", async () => {
    const { resolveTheme, systemTheme } = await import("./theme");
    const os = systemTheme();
    // The case the feature exists for: the OS says one thing, the user chose the other, and the
    // user wins. A resolver that only overrode one way would silently revert half its users.
    localStorage.setItem("grok-workspace-theme", os === "dark" ? "light" : "dark");
    expect(resolveTheme()).not.toBe(os);
    localStorage.setItem("grok-workspace-theme", os);
    expect(resolveTheme()).toBe(os);
    localStorage.removeItem("grok-workspace-theme");
    expect(resolveTheme()).toBe(os);
  });
});

describe("a workspace with no project", () => {
  /**
   * The shell used to substitute one screen for MAIN whenever there was no project, and this test
   * asserted that. After a purge it meant every tab showed the same thing: clicking Assets or Users
   * changed the navigator and nothing else, so the tabs read as broken. A shell that overrides every
   * page with one page has stopped being a shell.
   *
   * What it guards now is that the pages still mount and still differ. Where the front door belongs
   * — AGENTS and DESIGN DOCUMENTS — the page shows it itself.
   */
  test("still mounts each page, so the tabs do not all show one screen", async () => {
    stubServer({ projects: [] });
    atUrl(workspaceUrl("assets"));
    render(<WorkspaceShell />);
    await waitFor(() => expect(screen.getByTestId("main")).toBeDefined());

    // The page, not a shell-wide substitute.
    expect(screen.queryByTestId("no-project")).toBeNull();
    const assetsText = screen.getByTestId("main").textContent ?? "";
    cleanup();

    atUrl(workspaceUrl("users"));
    render(<WorkspaceShell />);
    await waitFor(() => expect(screen.getByTestId("main")).toBeDefined());
    expect(screen.getByTestId("main").textContent).not.toBe(assetsText);
  });

  test("the front door is on the page where starting a project belongs", async () => {
    stubServer({ projects: [] });
    atUrl(workspaceUrl("agents"));
    render(<WorkspaceShell />);
    expect((await screen.findByTestId("start-project")).textContent).toContain("design document");
  });
});

describe("the Tools overlay", () => {
  test("opens over MAIN from every page, and the page underneath stays mounted", async () => {
    for (const page of PAGES) {
      atUrl(workspaceUrl(page.id));
      await mount();
      await act(async () => {
        fireEvent.click(screen.getByTestId("tools-open"));
      });
      const overlay = screen.getByTestId("tools-overlay");
      const main = screen.getByTestId("main");

      // Over MAIN, not instead of it. Asserting that both elements merely EXIST is not enough —
      // that stays true when the overlay stops overlaying, which a mutation probe demonstrated.
      // Three facts together make it an overlay: it lives inside MAIN, MAIN's own content is
      // still mounted beside it, and it is taken out of flow.
      expect(main.contains(overlay)).toBe(true);
      // MAIN's own content is still mounted beside the overlay. This used to look for the
      // unmerged-page placeholder, which worked only while MAIN was a hole — every page has since
      // been built. What it always meant is this: MAIN has a child that is not the overlay.
      const beside = Array.from(main.children).filter((el) => el !== overlay);
      expect(beside.length).toBeGreaterThan(0);
      expect(overlay.className).toContain("absolute");
      expect(overlay.className).toContain("inset-0");
      expect(screen.getByTestId(`page-${page.id}`).getAttribute("aria-current")).toBe("page");
      cleanup();
    }
  });

  test("is a query parameter, so the page underneath is not lost", async () => {
    atUrl(workspaceUrl("assets", "asset_1"));
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId("tools-open"));
    });
    expect(location.pathname).toBe("/assets/asset_1");
    expect(location.search).toBe("?tools=prompts");
  });

  test("Esc dismisses it and restores the page unchanged, with the parameter removed", async () => {
    atUrl(workspaceUrl("designdocs", "doc_1", "skills"));
    await mount();
    expect(screen.getByTestId("tools-overlay")).toBeDefined();

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByTestId("tools-overlay")).toBeNull();
    expect(location.pathname).toBe("/designdocs/doc_1");
    expect(location.search).toBe("");
    expect(screen.getByTestId("page-designdocs").getAttribute("aria-current")).toBe("page");
  });

  test("clicking the scrim is the same dismissal as Esc", async () => {
    atUrl(workspaceUrl("agents", undefined, "skills"));
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId("tools-scrim"));
    });
    expect(screen.queryByTestId("tools-overlay")).toBeNull();
    expect(location.search).toBe("");
  });

  test("Cmd-T opens it, the shortcut both wireframes print on the control", async () => {
    await mount();
    await act(async () => {
      fireEvent.keyDown(window, { key: "t", metaKey: true });
    });
    expect(screen.getByTestId("tools-overlay")).toBeDefined();
    expect(location.search).toBe("?tools=prompts");
  });

  test("a url naming a section opens that section on a cold mount", async () => {
    atUrl(workspaceUrl("assets", undefined, "skills"));
    await mount();
    expect(screen.getByTestId("tools-section-skills").getAttribute("aria-current")).toBe("page");
  });

  test("both sections are offered, so skills is reachable without typing a URL", async () => {
    // The section used to be a label. The toolbar opens `prompts`, nothing anywhere wrote `skills`,
    // and so the whole skills half of the panel was built, shipped, and unreachable — the user's
    // report was "the tools section still has just prompts".
    atUrl(workspaceUrl("agents", undefined, "prompts"));
    await mount();
    expect(screen.getByTestId("tools-section-prompts")).toBeDefined();
    expect(screen.getByTestId("tools-section-skills")).toBeDefined();
  });

  test("choosing a section writes the URL, so it is shareable and survives a reload", async () => {
    atUrl(workspaceUrl("agents", undefined, "prompts"));
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId("tools-section-skills"));
    });
    expect(location.search).toBe("?tools=skills");
    expect(screen.getByTestId("tools-section-skills").getAttribute("aria-current")).toBe("page");
    // The page underneath is untouched — that is the whole argument for an overlay.
    expect(location.pathname).toBe("/agents");
  });

  test("switching sections keeps the selection under the overlay", async () => {
    atUrl(workspaceUrl("assets", "asset_1", "prompts"));
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId("tools-section-skills"));
    });
    expect(location.pathname).toBe("/assets/asset_1");
    expect(location.search).toBe("?tools=skills");
  });

  test("renders the Tools panel now that pivot/tools has merged", async () => {
    atUrl(workspaceUrl("agents", undefined, "prompts"));
    await mount();
    // This asserted the unmerged notice through two merges — first counting two holes, then one.
    // pivot/tools has now landed and TOOLS_PANEL is set, so what it guards is the opposite: the
    // panel renders real content and no hole remains anywhere on the page.
    const panel = screen.getByTestId("tools-panel");
    expect(panel.querySelector("[data-testid='not-merged-yet']")).toBeNull();
    expect(screen.queryAllByTestId("not-merged-yet").length).toBe(0);
  });

  test("the shell owns the dismissal, so the panel needs no visibility of its own", async () => {
    atUrl(workspaceUrl("agents", undefined, "prompts"));
    await mount();
    // If the panel rendered its own scrim or Esc handler, two dismissal paths would fight and the
    // query parameter would desynchronise from the DOM. The scrim and the close control are both
    // the shell's, and both write the URL.
    expect(screen.getByTestId("tools-scrim")).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByTestId("tools-close"));
    });
    expect(location.search).toBe("");
  });
});

describe("the ? control the wireframes draw beside the theme switch", () => {
  test("it is closed until asked, and says what this workspace is", async () => {
    await mount();
    expect(screen.queryByTestId("help-panel")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("help-open"));
    });
    const panel = screen.getByTestId("help-panel");
    // The four facts it exists to state. Asserted by content rather than by presence, because a
    // help panel that opens and says nothing useful passes a presence test.
    expect(panel.textContent).toContain("Three regions");
    expect(panel.textContent).toContain("⌘T");
    expect(panel.textContent).toContain("An agent can only change things inside its own area");
    expect(panel.textContent).toContain("Nobody signs in");
  });

  test("it closes again, both ways", async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId("help-open"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("help-close"));
    });
    expect(screen.queryByTestId("help-panel")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("help-open"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("help-open"));
    });
    expect(screen.queryByTestId("help-panel")).toBeNull();
  });

  test("it announces its own state, so it is reachable without a mouse", async () => {
    await mount();
    const button = screen.getByTestId("help-open");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});
