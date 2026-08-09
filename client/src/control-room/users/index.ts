/**
 * Everything the rest of the product may use from this surface.
 *
 * loops/08-users-and-x.md §0: "the users page and the X page each export one component from
 * `client/src/control-room/users/index.ts`, taking props and importing no shell internals". The
 * only thing this directory imports from 07-shell is `shell/contract.ts` — the file whose own
 * header says every declaration in it is consumed by another worktree, and which imports nothing
 * so that it typechecks with no other shell file present. That is the seam; `WorkspaceShell`,
 * `regions`, `router` and `theme` are not, and nothing here reaches for them.
 *
 * ### How this page is mounted, and why that is one line somebody else writes
 *
 * `client/src/control-room/shell/pages.ts` is 07-shell's file and its header reserves the edit for
 * reconciliation. So this loop does not make it. The edit is:
 *
 * ```diff
 * -  { id: "users", label: "Users", segment: "users", rank: "secondary", builtBy: "08-users-x" },
 * +  { id: "users", label: "Users", segment: "users", rank: "secondary", builtBy: "08-users-x",
 * +    ...USERS_PAGE_SLOTS },
 * ```
 *
 * with `import { USERS_PAGE_SLOTS } from "../users";` at the top. It is filed verbatim in
 * `loops/handoff/pivot-users-x.md`. Exporting the three slots as one object rather than three
 * named components is what keeps it to one line: the row keeps its id, label, segment and rank,
 * which are 07-shell's to decide, and gains only the components, which are this loop's.
 *
 * ### The X page, stage 14 — built
 *
 * It was the outstanding hole in this contract and it is now `X_PAGE_SLOTS`, spread into the `x`
 * row the same way. Two things about it that are not true of the users row:
 *
 *   - **the credentials it was blocked on turned out to exist.** The loop recorded `X_CLIENT_ID` /
 *     `X_CLIENT_SECRET` as absent, and they are — but `credentialsFromEnv()` wants OAuth 1.0a user
 *     tokens (`consumer_key`, `consumer_secret`, `x_access_token`, `x_access_secret`) and this
 *     machine's `.env` has all four. Nothing was mocked to unblock this.
 *   - **its row is conditional.** XAP-008 says an unconfigured X page is absent from the navigation
 *     rather than disabled, so `pages.ts` filters it on `useXConfigured()`, which starts false and
 *     is revealed only once the server confirms. That is the one page in the registry whose
 *     presence is a runtime fact rather than a merge fact.
 */
import type { PageDescriptor } from "../shell/contract";
import { UsersPageInspector } from "./UserInspector";
import { UsersPageNavigator } from "./UsersNavigator";
import { UsersPageMain } from "./UsersPage";
import { XPageInspector } from "./x/XInspector";
import { XPageNavigator } from "./x/XNavigator";
import { XPageMain } from "./x/XPage";

export { UsersPageMain as UsersPage } from "./UsersPage";
export { UsersPageNavigator } from "./UsersNavigator";
export { UsersPageInspector } from "./UserInspector";

export { XPageMain as XPage } from "./x/XPage";
export { XPageNavigator } from "./x/XNavigator";
export { XPageInspector } from "./x/XInspector";

/**
 * Whether the X page exists at all. `pages.ts` filters its row on this — XAP-008.
 *
 * `setXConfiguredForTest` is exported alongside it for the same reason the hook is: SHELL-017
 * forbids the shell reaching into `../users/<anything>/`, and the shell's own tests need to state
 * which kind of workspace they are describing. One entry point, for the product and for its tests.
 */
export { useXConfigured, setXConfiguredForTest } from "./x/availability";

export type { CapabilityGrant, Role, WorkspaceUser } from "./types";

/** The three slots, shaped for one `...spread` into the `users` row of the shell's registry. */
export const USERS_PAGE_SLOTS: Pick<PageDescriptor, "main" | "navigator" | "inspector"> = {
  main: UsersPageMain,
  navigator: UsersPageNavigator,
  inspector: UsersPageInspector,
};

/** The same three, for the `x` row. Its presence is conditional; its contents are not. */
export const X_PAGE_SLOTS: Pick<PageDescriptor, "main" | "navigator" | "inspector"> = {
  main: XPageMain,
  navigator: XPageNavigator,
  inspector: XPageInspector,
};
