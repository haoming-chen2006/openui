/**
 * The X page — loops/08-users-and-x.md §3.12, §3.15, XAP-008.
 *
 * Two things are asserted here that no server test can reach:
 *
 *   - **XAP-008 is a property of the navigation, not of the page.** "Not disabled, not greyed" is a
 *     claim about what the page selector contains, so it is checked against `useVisiblePages()` —
 *     the registry the shell actually draws from — rather than against anything this directory
 *     renders.
 *   - **the confirmation shows the artefact and names what cannot be undone.** §3.12's whole
 *     argument is that a person approving words they cannot see is not approving anything, and the
 *     dry-run line and the permanent line are mutually exclusive. A dialog that showed neither, or
 *     both, would still typecheck.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PAGES, useVisiblePages } from "../../shell/pages";
import { setXConfiguredForTest } from "./availability";
import { XPage, XPageInspector, XPageNavigator } from "../index";
import { resetXState } from "./xStore";
import type { XDraft, XStatus } from "./types";

const realFetch = globalThis.fetch;

/** What the fake server holds. Each case rewrites the parts it cares about. */
let status: XStatus;
let drafts: XDraft[];
let records: any[];
/** Every `POST /api/x/publish` body, so a test can assert what the page actually sent. */
let publishCalls: any[];

function stubServer() {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    const json = (body: unknown, code = 200) =>
      new Response(JSON.stringify(body), {
        status: code,
        headers: { "Content-Type": "application/json" },
      });

    if (url.startsWith("/api/x/status")) return json(status);
    if (url.startsWith("/api/x/drafts") && (!init || init.method === undefined)) {
      return json({ drafts });
    }
    if (url.startsWith("/api/x/history")) return json({ records });
    if (url === "/api/x/publish") {
      const body = JSON.parse(init.body);
      publishCalls.push(body);
      const record = {
        id: "pub_test",
        state: "published",
        text: drafts[0]?.text ?? "",
        confirmedBy: body.confirmedBy,
        selfApproved: true,
        dryRun: body.dryRun,
        confirmedAt: "2026-08-08T00:00:00.000Z",
      };
      return json({ record, post: { id: "dryrun_1", text: record.text, dryRun: true, at: "" }, deduplicated: false });
    }
    return json({ error: `unstubbed ${url}` }, 404);
  }) as unknown as typeof fetch;
}

const noop = () => {};

beforeEach(() => {
  status = { configured: true, missing: [], dryRun: true, account: { id: "1", username: "dry_run", name: "Dry run" }, accountError: null };
  drafts = [];
  records = [];
  publishCalls = [];
  resetXState();
  stubServer();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  setXConfiguredForTest(null);
});

// ─────────────────────────────────────────────────────────────────────────────── XAP-008

describe("XAP-008: optional means absent", () => {
  /** A component that exists only to read the hook — the registry is the thing under test. */
  function Nav() {
    const pages = useVisiblePages();
    return <span data-testid="ids">{pages.map((p) => p.id).join(",")}</span>;
  }

  test("with no X credentials the page is not in the navigation at all", () => {
    setXConfiguredForTest(false);
    render(<Nav />);
    const ids = screen.getByTestId("ids").textContent ?? "";
    expect(ids).not.toContain("x");
    // Not a disabled row, not a greyed row — the row is gone. Every other page is still there.
    expect(ids.split(",")).toEqual(["agents", "assets", "designdocs", "users"]);
  });

  test("with credentials it appears", () => {
    setXConfiguredForTest(true);
    render(<Nav />);
    expect((screen.getByTestId("ids").textContent ?? "").split(",")).toContain("x");
  });

  test("it is hidden before the probe answers, never shown and then removed", () => {
    // A status endpoint that never answers — which is what "before the probe answers" IS, and the
    // only way to hold the page in that state long enough to assert on it.
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    setXConfiguredForTest(null);
    render(<Nav />);
    // Being wrong in the reassuring direction — showing the tab and taking it away — would put the
    // page in the navigation of every workspace without X, briefly, on every load.
    expect(screen.getByTestId("ids").textContent).not.toContain("x");
  });

  test("the registry still declares the row, so the page is mounted and not merely routed", () => {
    const row = PAGES.find((p) => p.id === "x");
    expect(row?.main).toBeDefined();
    expect(row?.navigator).toBeDefined();
    expect(row?.inspector).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────── the page

describe("the connected account", () => {
  test("names the account, and says the connection is the server's credentials", async () => {
    render(<XPage projectId="p1" onSelect={noop} />);
    await waitFor(() => expect(screen.getByTestId("x-account-line").textContent).toContain("@dry_run"));
    expect(screen.getByTestId("x-account-line").textContent).toContain("environment");
  });

  test("a rejected credential is a connection to fix, not a missing feature", async () => {
    status = { ...status, account: null, accountError: "X refused this request (HTTP 401)" };
    render(<XPage projectId="p1" onSelect={noop} />);
    await waitFor(() => expect(screen.getByTestId("x-account-line").textContent).toContain("401"));
    // Still configured, so the page still exists — the two facts are independent.
    expect(status.configured).toBe(true);
  });

  test("the mode badge says which of the two things a confirmation would do", async () => {
    render(<XPage projectId="p1" onSelect={noop} />);
    await waitFor(() => expect(screen.getByTestId("x-mode").textContent).toContain("dry run"));

    cleanup();
    resetXState();
    status = { ...status, dryRun: false };
    render(<XPage projectId="p1" onSelect={noop} />);
    await waitFor(() => expect(screen.getByTestId("x-mode").textContent).toContain("live"));
  });
});

describe("the drafts", () => {
  test("an empty list says why agents have not written one, rather than showing nothing", async () => {
    render(<XPage projectId="p1" onSelect={noop} />);
    await waitFor(() => expect(screen.getByTestId("x-drafts-empty")).toBeDefined());
    expect(screen.getByTestId("x-drafts-empty").textContent).toContain("draft_x_post");
  });

  test("a draft nobody's agent wrote is not attributed to an agent", async () => {
    drafts = [{ id: "d1", text: "written by a person", createdAt: "2026-08-08T00:00:00.000Z" }];
    render(<XPage projectId="p1" onSelect={noop} />);
    await waitFor(() => expect(screen.getByTestId("x-draft-d1")).toBeDefined());
    expect(screen.getByTestId("x-draft-d1").textContent).toContain("written here, not by an agent");
  });

  test("an unpriced draft reads as unpriced and never as $0.00", async () => {
    drafts = [{ id: "d1", text: "no price", costUsd: null, createdAt: "2026-08-08T00:00:00.000Z" }];
    render(<XPage projectId="p1" onSelect={noop} />);
    await waitFor(() => expect(screen.getByTestId("x-draft-d1")).toBeDefined());
    expect(screen.getByTestId("x-draft-d1").textContent).toContain("unpriced");
    expect(screen.getByTestId("x-draft-d1").textContent).not.toContain("$0.00");
  });
});

// ──────────────────────────────────────────────────────────────────────── §3.12 confirm

describe("§3.12: the confirmation", () => {
  beforeEach(() => {
    drafts = [
      {
        id: "d1",
        text: "the exact words that would go out",
        projectId: "p1",
        costUsd: null,
        createdAt: "2026-08-08T00:00:00.000Z",
      },
    ];
  });

  async function openConfirm() {
    render(<XPage projectId="p1" onSelect={noop} />);
    await waitFor(() => expect(screen.getByTestId("x-publish-d1")).toBeDefined());
    fireEvent.click(screen.getByTestId("x-publish-d1"));
    await waitFor(() => expect(screen.getByTestId("x-confirm")).toBeDefined());
  }

  test("shows the artefact itself, not a summary of it", async () => {
    await openConfirm();
    expect(screen.getByTestId("x-confirm-text").textContent).toBe("the exact words that would go out");
  });

  test("a dry run says nothing will be sent", async () => {
    await openConfirm();
    expect(screen.getByTestId("x-confirm-consequence").textContent).toContain("DRY RUN");
  });

  test("a live post names what cannot be undone, in those words", async () => {
    status = { ...status, dryRun: false };
    await openConfirm();
    const said = screen.getByTestId("x-confirm-consequence").textContent ?? "";
    expect(said).toContain("public and permanent");
    expect(said).toContain("Deleting it later does not unsend it");
    expect(said).not.toContain("DRY RUN");
  });

  test("focus lands on Cancel, so a stray Return does not post", async () => {
    await openConfirm();
    expect(document.activeElement).toBe(screen.getByTestId("x-confirm-cancel"));
  });

  test("cancelling sends nothing", async () => {
    await openConfirm();
    fireEvent.click(screen.getByTestId("x-confirm-cancel"));
    await waitFor(() => expect(screen.queryByTestId("x-confirm")).toBeNull());
    expect(publishCalls).toHaveLength(0);
  });

  test("confirming sends the dry-run value the dialog showed, not a re-read one", async () => {
    await openConfirm();
    await act(async () => {
      fireEvent.click(screen.getByTestId("x-confirm-publish"));
    });
    await waitFor(() => expect(publishCalls).toHaveLength(1));
    expect(publishCalls[0]).toMatchObject({
      draftId: "d1",
      confirmedBy: "owner_this_machine",
      dryRun: true,
    });
    // Never the string "user" — `publishRecord.ts` forbids it and a page is where it would appear.
    expect(publishCalls[0].confirmedBy).not.toBe("user");
  });
});

// ──────────────────────────────────────────────────────────────────── navigator + inspector

describe("§3.13: an unresolved post is not a failure", () => {
  test("the navigator says to read the account rather than to send again", async () => {
    records = [
      {
        id: "pub_1",
        state: "unknown",
        text: "did this go out?",
        confirmedBy: "owner_this_machine",
        selfApproved: true,
        dryRun: false,
        confirmedAt: "2026-08-08T00:00:00.000Z",
        error: "the request to X timed out",
      },
    ];
    render(
      <>
        <XPage projectId="p1" onSelect={noop} />
        <XPageNavigator projectId="p1" onSelect={noop} />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("x-unsettled")).toBeDefined());
    expect(screen.getByTestId("x-unsettled").textContent).toContain("Read the account");
  });

  test("the inspector spells out why a second attempt does not help", async () => {
    records = [
      {
        id: "pub_1",
        state: "unknown",
        text: "did this go out?",
        confirmedBy: "owner_this_machine",
        selfApproved: true,
        dryRun: false,
        confirmedAt: "2026-08-08T00:00:00.000Z",
      },
    ];
    render(
      <>
        <XPage projectId="p1" selectionId="pub_1" onSelect={noop} />
        <XPageInspector projectId="p1" selectionId="pub_1" onSelect={noop} />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("x-unknown-guidance")).toBeDefined());
    expect(screen.getByTestId("x-unknown-guidance").textContent).toContain("This is not a failure");
  });
});
