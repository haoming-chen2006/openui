import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Hono } from "hono";
import { xRoutes, resetXAccountCache } from "./x";
import { resetXDraftStore } from "../services/x/draftStore";
import { resetPublishRecordStore } from "../services/x/publishRecord";

/**
 * HTTP coverage for the X page's surface (XAP-006, XAP-007, XAP-008, §3.13, §3.14).
 *
 * These endpoints are the callers `services/x/**` never had: `publishToX` was built in stage 13,
 * tested, and reached by nothing, because the page that was meant to call it was the stage that
 * did not run. A service can be correct while the route in front of it defaults a field the
 * service forbids, or answers 500 to a `refused` and loses the record id with it.
 *
 * **Every case runs dry.** `X_DRY_RUN=1` is set in `beforeEach` and the credentials are fake, so
 * nothing here can reach api.x.com — which is §3.14's rule, and the reason most of this surface
 * was testable before any X application existed.
 */

let dataDir: string;
let app: Hono;
const saved: Record<string, string | undefined> = {};

const CREDENTIAL_KEYS = [
  "consumer_key",
  "consumer_secret",
  "x_access_token",
  "x_access_secret",
  "X_CONSUMER_KEY",
  "X_CONSUMER_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_SECRET",
  "x_api_key",
  "x_api_secret",
  "X_DRY_RUN",
];

async function req(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, json: { error: text } as any };
  }
}

/** A draft, created through the route rather than the store, so the POST is covered too. */
async function draft(text: string, extra: Record<string, unknown> = {}) {
  const { status, json } = await req("POST", "/api/x/drafts", { text, ...extra });
  expect(status).toBe(201);
  return json;
}

beforeEach(() => {
  for (const key of CREDENTIAL_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  dataDir = mkdtempSync(join(tmpdir(), "openui-x-"));
  process.env.OPENUI_DATA_DIR = dataDir;
  // The developer's own `.env` has real credentials. Overwriting them with obvious fakes is what
  // guarantees a bug in this file cannot post to anybody's timeline.
  process.env.consumer_key = "test_consumer_key";
  process.env.consumer_secret = "test_consumer_secret";
  process.env.x_access_token = "test_access_token";
  process.env.x_access_secret = "test_access_secret";
  process.env.X_DRY_RUN = "1";

  resetXDraftStore();
  resetPublishRecordStore();
  resetXAccountCache();

  app = new Hono();
  app.route("/api/x", xRoutes);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  for (const key of CREDENTIAL_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key] as string;
  }
  resetXAccountCache();
});

describe("XAP-008: status answers before the page decides whether it exists", () => {
  test("configured, with the dry-run account and no network call", async () => {
    const { status, json } = await req("GET", "/api/x/status");
    expect(status).toBe(200);
    expect(json.configured).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.account.username).toBe("dry_run");
    expect(json.accountError).toBeNull();
  });

  test("a missing credential makes it unconfigured, and names which one", async () => {
    delete process.env.x_access_secret;
    resetXAccountCache();
    const { json } = await req("GET", "/api/x/status");
    expect(json.configured).toBe(false);
    expect(json.missing).toContain("accessSecret");
    expect(json.account).toBeNull();
  });

  test("no credentials at all still answers 200 — the page must be able to ask", async () => {
    for (const key of ["consumer_key", "consumer_secret", "x_access_token", "x_access_secret"]) {
      delete process.env[key];
    }
    resetXAccountCache();
    const { status, json } = await req("GET", "/api/x/status");
    expect(status).toBe(200);
    expect(json.configured).toBe(false);
    expect(json.missing).toHaveLength(4);
  });
});

describe("drafts", () => {
  test("a draft is created, listed and discarded", async () => {
    const created = await draft("the first draft", { projectId: "p1" });
    expect(created.id).toStartWith("xdraft_");
    expect(created.publishedRecordId).toBeUndefined();

    const listed = await req("GET", "/api/x/drafts?projectId=p1");
    expect(listed.json.drafts).toHaveLength(1);

    // A different project's list does not contain it — the filter is real, not decorative.
    const other = await req("GET", "/api/x/drafts?projectId=p2");
    expect(other.json.drafts).toHaveLength(0);

    const removed = await req("DELETE", `/api/x/drafts/${created.id}`);
    expect(removed.status).toBe(200);
    expect((await req("GET", "/api/x/drafts")).json.drafts).toHaveLength(0);
  });

  test("a draft over the limit is refused at the draft, not at the confirmation", async () => {
    const { status, json } = await req("POST", "/api/x/drafts", { text: "x".repeat(281) });
    expect(status).toBe(400);
    expect(json.error).toContain("281");
  });

  test("an unpriced draft keeps null and never becomes zero", async () => {
    const created = await draft("unpriced", { costUsd: null });
    expect(created.costUsd).toBeNull();
  });

  test("discarding a draft that is not there is a 404, not a silent success", async () => {
    const { status } = await req("DELETE", "/api/x/drafts/xdraft_nope");
    expect(status).toBe(404);
  });
});

describe("XAP-006: publishing records who confirmed it", () => {
  test("a dry run publishes, and the record says it was dry", async () => {
    const d = await draft("hello from the dry run", { projectId: "p1" });
    const { status, json } = await req("POST", "/api/x/publish", {
      draftId: d.id,
      confirmedBy: "owner_this_machine",
      dryRun: true,
    });

    expect(status).toBe(200);
    expect(json.record.state).toBe("published");
    expect(json.record.dryRun).toBe(true);
    expect(json.record.confirmedBy).toBe("owner_this_machine");
    expect(json.record.selfApproved).toBe(true);
    expect(json.post.id).toStartWith("dryrun_");

    // And the draft now points at the record, so the list stops offering it.
    const listed = await req("GET", "/api/x/drafts");
    expect(listed.json.drafts[0].publishedRecordId).toBe(json.record.id);
  });

  test("confirmedBy is required and is never defaulted", async () => {
    const d = await draft("who pressed the button");
    const { status, json } = await req("POST", "/api/x/publish", { draftId: d.id, dryRun: true });
    expect(status).toBe(400);
    expect(json.error).toContain("confirmedBy");

    // Nothing was recorded — a refused publish must not leave a claimed key behind.
    expect((await req("GET", "/api/x/history")).json.records).toHaveLength(0);
  });

  test("the history carries the cost and the approver", async () => {
    const d = await draft("costed", { costUsd: 0.07 });
    await req("POST", "/api/x/publish", {
      draftId: d.id,
      confirmedBy: "owner_this_machine",
      dryRun: true,
    });
    const { json } = await req("GET", "/api/x/history");
    expect(json.records).toHaveLength(1);
    expect(json.records[0].costUsd).toBe(0.07);
    expect(json.records[0].confirmedBy).toBe("owner_this_machine");
  });
});

describe("XAP-007: a publish cannot happen twice", () => {
  test("the same draft confirmed again is refused, and nothing is sent", async () => {
    const d = await draft("only once");
    const first = await req("POST", "/api/x/publish", {
      draftId: d.id,
      confirmedBy: "owner_this_machine",
      dryRun: true,
    });
    expect(first.json.record.state).toBe("published");

    const second = await req("POST", "/api/x/publish", {
      draftId: d.id,
      confirmedBy: "owner_this_machine",
      dryRun: true,
    });
    expect(second.status).toBe(409);
    expect(second.json.recordId).toBe(first.json.record.id);

    // One record, not two. This is the assertion that would fail if the route re-derived a key.
    expect((await req("GET", "/api/x/history")).json.records).toHaveLength(1);
  });

  test("a draft that does not exist is a 404 rather than an ad-hoc post", async () => {
    const { status } = await req("POST", "/api/x/publish", {
      draftId: "xdraft_missing",
      confirmedBy: "owner_this_machine",
      dryRun: true,
    });
    expect(status).toBe(404);
  });
});

describe("the dry-run interlock", () => {
  /**
   * The failure this prevents: a page rendered while `X_DRY_RUN=1` was set, left open across a
   * restart that unset it, and confirmed. Everything on screen said "nothing will be sent" over a
   * button that would have sent. The page states which of the two it is showing; the server checks.
   */
  test("a page showing 'dry run' cannot publish against a live server", async () => {
    process.env.X_DRY_RUN = "";
    const d = await draft("stale page");

    const { status, json } = await req("POST", "/api/x/publish", {
      draftId: d.id,
      confirmedBy: "owner_this_machine",
      dryRun: true, // what the confirmation dialog told the user
    });

    expect(status).toBe(409);
    expect(json.code).toBe("dry_run_mismatch");
    expect(json.dryRun).toBe(false);
    // Nothing was claimed, so nothing is half-done and the draft is still offerable.
    expect((await req("GET", "/api/x/history")).json.records).toHaveLength(0);
    expect((await req("GET", "/api/x/drafts")).json.drafts[0].publishedRecordId).toBeUndefined();
  });

  test("a page showing 'live' cannot publish against a dry server either", async () => {
    const d = await draft("the other direction");
    const { status, json } = await req("POST", "/api/x/publish", {
      draftId: d.id,
      confirmedBy: "owner_this_machine",
      dryRun: false,
    });
    expect(status).toBe(409);
    expect(json.code).toBe("dry_run_mismatch");
  });

  test("a caller that states nothing is allowed through — the interlock is opt-in", async () => {
    const d = await draft("no claim made");
    const { status, json } = await req("POST", "/api/x/publish", {
      draftId: d.id,
      confirmedBy: "owner_this_machine",
    });
    expect(status).toBe(200);
    expect(json.record.dryRun).toBe(true);
  });
});
