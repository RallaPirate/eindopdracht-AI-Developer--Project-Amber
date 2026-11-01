import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  applyBrowserAuthEvent,
  applyPermissionRead,
  authenticatedQueryKey,
  authenticatedQueryUserId,
  classifyAuthVerification,
  classifyPermissionRead,
  createAuthenticatedQueryCache,
  createAuthTransitionController,
  failureOf,
  isAuthenticatedAccessCurrent,
  resolveAuthVerification,
  shouldRunAuthenticatedQuery,
  stripPrivilegedQueryOptions,
} from "./queryCacheIsolation.ts";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function flushMicrotasks() {
  return new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
}

test("authenticated query keys include the verified user id", () => {
  const key = authenticatedQueryKey("user-a", ["species", "list"]);
  assert.deepEqual(key, ["auth-user", "user-a", "species", "list"]);
  assert.equal(authenticatedQueryUserId(key), "user-a");
  assert.equal(authenticatedQueryUserId(["species"]), null);
  assert.equal(
    authenticatedQueryUserId(["auth-user", "unverified", "species"]),
    null,
  );
});

test("authenticated queries stay disabled until a user id is verified", () => {
  assert.equal(shouldRunAuthenticatedQuery(null), false);
  assert.equal(shouldRunAuthenticatedQuery(null, true), false);
  assert.equal(shouldRunAuthenticatedQuery("user-a", false), false);
  assert.equal(shouldRunAuthenticatedQuery("user-a"), false);
  assert.equal(shouldRunAuthenticatedQuery("user-a", true, "unknown"), false);
  assert.equal(shouldRunAuthenticatedQuery("user-a", true, "active"), true);
  assert.equal(shouldRunAuthenticatedQuery("user-a", true, "revoked"), false);
});

test("the same verified user keeps cached data across a repeated bind", () => {
  const client = new QueryClient();
  const identity = createAuthenticatedQueryCache();
  identity.installGuard(client);

  identity.bindUser(client, "user-a");
  const key = authenticatedQueryKey("user-a", ["species"]);
  client.setQueryData(key, ["row-a"]);

  identity.bindUser(client, "user-a");

  assert.deepEqual(client.getQueryData(key), ["row-a"]);
  client.clear();
});

test("logout clears cached rows and a late write cannot repopulate them", async () => {
  const client = new QueryClient();
  const identity = createAuthenticatedQueryCache();
  identity.installGuard(client);

  identity.bindUser(client, "user-a");
  const key = authenticatedQueryKey("user-a", ["species"]);
  client.setQueryData(key, ["row-a"]);

  identity.bindUser(client, null);
  assert.equal(client.getQueryData(key), undefined);
  assert.equal(identity.getSnapshot().userId, null);

  client.setQueryData(key, ["row-a-late"]);
  await flushMicrotasks();

  assert.equal(client.getQueryData(key), undefined);
  client.clear();
});

test("account switch isolates the previous user and drops a delayed response", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const identity = createAuthenticatedQueryCache();
  identity.installGuard(client);

  const pending = deferred<string[]>();
  identity.bindUser(client, "user-a");

  const keyA = authenticatedQueryKey("user-a", ["species"]);
  const keyB = authenticatedQueryKey("user-b", ["species"]);

  const inFlight = client.query({
    queryKey: keyA,
    queryFn: () => pending.promise,
  });

  identity.bindUser(client, "user-b");
  pending.resolve(["secret-a"]);
  await inFlight.catch(() => undefined);
  await flushMicrotasks();

  assert.equal(client.getQueryData(keyA), undefined);
  assert.equal(client.getQueryData(keyB), undefined);
  assert.equal(identity.getSnapshot().userId, "user-b");

  client.setQueryData(keyA, ["secret-a-late"]);
  await flushMicrotasks();
  assert.equal(client.getQueryData(keyA), undefined);
  assert.equal(client.getQueryData(keyB), undefined);
  client.clear();
});

test("a role change resets cached rows for the same user", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const identity = createAuthenticatedQueryCache();
  identity.installGuard(client);

  identity.bindUser(client, "user-a");
  const key = authenticatedQueryKey("user-a", ["reports"]);
  client.setQueryData(key, ["management-only"]);

  identity.bindPermission(client, "user-a", "management");
  assert.deepEqual(client.getQueryData(key), ["management-only"]);
  assert.equal(identity.getPermissionScope(), "management");

  identity.bindPermission(client, "user-a", "employee");
  await flushMicrotasks();

  assert.equal(client.getQueryData(key), undefined);
  assert.equal(identity.getPermissionScope(), "employee");
  client.clear();
});

test("a permission update for a different user does not reset the bound cache", () => {
  const client = new QueryClient();
  const identity = createAuthenticatedQueryCache();

  identity.bindUser(client, "user-a");
  const key = authenticatedQueryKey("user-a", ["reports"]);
  client.setQueryData(key, ["row-a"]);

  identity.bindPermission(client, "user-b", "employee");

  assert.deepEqual(client.getQueryData(key), ["row-a"]);
  assert.equal(identity.getPermissionScope(), null);
  client.clear();
});

test("session restoration binds the verified user without treating it as signed out", () => {
  const client = new QueryClient();
  const identity = createAuthenticatedQueryCache();

  assert.equal(identity.getSnapshot().userId, null);
  assert.equal(shouldRunAuthenticatedQuery(identity.getSnapshot().userId), false);

  identity.bindUser(client, "user-a");

  assert.equal(identity.getSnapshot().userId, "user-a");
  assert.equal(
    shouldRunAuthenticatedQuery(
      identity.getSnapshot().userId,
      true,
      identity.getSnapshot().permissionStatus,
    ),
    false,
  );
  client.clear();
});

test("a successful getClaims result binds the verified user", async () => {
  const client = new QueryClient();
  const cache = createAuthenticatedQueryCache();
  cache.installGuard(client);
  const transitions = createAuthTransitionController(cache, () => client);
  const key = authenticatedQueryKey("user-a", ["species"]);

  assert.equal(failureOf(null), null);
  assert.equal(
    classifyAuthVerification(failureOf(null), "user-a"),
    "authenticated",
  );

  const generation = transitions.beginEvent("INITIAL_SESSION", "user-a");
  assert.equal(cache.getSnapshot().userId, null);

  const verified = resolveAuthVerification(null, "user-a", null, "user-a");
  assert.equal(verified.status, "authenticated");
  assert.equal(transitions.commit(generation, verified), "applied");
  assert.equal(cache.getSnapshot().userId, "user-a");
  applyPermissionRead(cache, client, "user-a", {
    status: "active",
    role: "employee",
  });

  client.setQueryDefaults(key, {
    meta: { accessEpoch: cache.getAccessEpoch() },
  });
  client.setQueryData(key, ["species-a"]);
  await flushMicrotasks();
  assert.deepEqual(client.getQueryData(key), ["species-a"]);
  client.clear();
});

test("auth changes drop the previous cache before verification resolves", () => {
  const client = new QueryClient();
  const cache = createAuthenticatedQueryCache();
  cache.installGuard(client);
  const transitions = createAuthTransitionController(cache, () => client);
  const key = authenticatedQueryKey("user-a", ["species"]);

  const restored = transitions.beginEvent("INITIAL_SESSION", "user-a");
  transitions.commit(
    restored,
    resolveAuthVerification(null, "user-a", null, "user-a"),
  );
  client.setQueryData(key, ["secret-a"]);

  const signedOut = transitions.beginEvent("SIGNED_OUT", null);
  assert.equal(cache.getSnapshot().userId, null);
  assert.equal(client.getQueryData(key), undefined);

  assert.equal(
    transitions.commit(
      restored,
      resolveAuthVerification(null, "user-a", null, "user-a"),
    ),
    "stale",
  );
  assert.equal(cache.getSnapshot().userId, null);
  assert.equal(
    resolveAuthVerification(null, "user-a", null, null).status,
    "stale",
  );
  assert.equal(
    transitions.commit(
      signedOut,
      resolveAuthVerification(null, "user-a", null, null),
    ),
    "applied",
  );
  assert.equal(cache.getSnapshot().userId, null);

  const switched = transitions.beginEvent("SIGNED_IN", "user-b");
  assert.equal(cache.getSnapshot().userId, null);
  assert.equal(client.getQueryData(key), undefined);
  assert.equal(
    transitions.commit(
      signedOut,
      resolveAuthVerification(null, "user-a", null, "user-a"),
    ),
    "stale",
  );
  assert.equal(
    transitions.commit(
      switched,
      resolveAuthVerification(null, "user-b", null, "user-b"),
    ),
    "applied",
  );
  assert.equal(cache.getSnapshot().userId, "user-b");
  assert.equal(client.getQueryData(key), undefined);
  client.clear();
});

test("same-user reauthentication blocks stale mutation rollbacks", () => {
  const client = new QueryClient();
  const cache = createAuthenticatedQueryCache();
  const key = authenticatedQueryKey("user-a", ["reports"]);

  cache.bindUser(client, "user-a");
  client.setQueryData(key, ["before-edit"]);
  const started = { userId: "user-a", epoch: cache.getAccessEpoch() };

  applyBrowserAuthEvent(cache, client, "SIGNED_IN", "user-a");

  assert.equal(cache.getSnapshot().userId, null);
  assert.equal(client.getQueryData(key), undefined);
  assert.equal(
    isAuthenticatedAccessCurrent(
      cache.getSnapshot().userId,
      cache.getAccessEpoch(),
      started,
    ),
    false,
  );

  const rollbackAllowed = isAuthenticatedAccessCurrent(
    cache.getSnapshot().userId,
    cache.getAccessEpoch(),
    started,
  );
  if (rollbackAllowed) {
    client.setQueryData(key, ["before-edit"]);
  }
  assert.equal(client.getQueryData(key), undefined);
  client.clear();
});

test("a role change removes cached rows instead of restoring initialData", () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const cache = createAuthenticatedQueryCache();
  const key = authenticatedQueryKey("user-a", ["reports"]);

  cache.bindUser(client, "user-a");
  cache.bindPermission(client, "user-a", "management");
  client.getQueryCache().build(client, {
    queryKey: key,
    initialData: ["privileged-initial"],
    queryFn: async () => ["fresh-employee-rows"],
  });
  assert.deepEqual(client.getQueryData(key), ["privileged-initial"]);

  cache.bindPermission(client, "user-a", "employee");

  assert.equal(client.getQueryData(key), undefined);
  assert.equal(client.getQueryCache().find({ queryKey: key }), undefined);
  assert.equal(cache.getPermissionScope(), "employee");
  client.clear();
});

test("privileged query options cannot carry initialData", () => {
  const stripped = stripPrivilegedQueryOptions({
    initialData: ["privileged-initial"],
    initialDataUpdatedAt: 10,
    placeholderData: ["previous-user"],
    staleTime: 1000,
  });

  assert.equal("initialData" in stripped, false);
  assert.equal("initialDataUpdatedAt" in stripped, false);
  assert.equal("placeholderData" in stripped, false);
  assert.equal(stripped.staleTime, 1000);
});

test("unlinked and invalid profiles revoke access and hide privileged rows", async () => {
  const client = new QueryClient();
  const cache = createAuthenticatedQueryCache();
  cache.installGuard(client);
  const key = authenticatedQueryKey("user-a", ["reports"]);

  assert.equal(classifyPermissionRead(false, false), "revoked");
  assert.equal(classifyPermissionRead(true, true), "unavailable");
  assert.equal(classifyPermissionRead(false, true), "active");

  cache.bindUser(client, "user-a");
  cache.bindPermission(client, "user-a", "management");
  client.setQueryData(key, ["management-only"]);

  applyPermissionRead(cache, client, "user-a", { status: "unavailable" });
  assert.equal(cache.getPermissionStatus(), "unavailable");
  assert.equal(cache.getPermissionScope(), null);
  assert.equal(cache.getSnapshot().status, "suspended");
  assert.equal(client.getQueryData(key), undefined);

  applyPermissionRead(cache, client, "user-a", {
    status: "active",
    role: "management",
  });
  assert.equal(cache.getPermissionStatus(), "active");
  client.setQueryData(key, ["management-only"]);

  applyPermissionRead(cache, client, "user-a", { status: "revoked" });
  assert.equal(cache.getPermissionStatus(), "revoked");
  assert.equal(cache.getPermissionScope(), null);
  assert.equal(client.getQueryData(key), undefined);

  client.setQueryData(key, ["management-only-late"]);
  await flushMicrotasks();
  assert.equal(client.getQueryData(key), undefined);
  client.clear();
});

test("a permission change blocks a pending mutation rollback", async () => {
  const client = new QueryClient();
  const cache = createAuthenticatedQueryCache();
  cache.installGuard(client);
  const key = authenticatedQueryKey("user-a", ["reports"]);

  cache.bindUser(client, "user-a");
  cache.bindPermission(client, "user-a", "management");
  client.setQueryData(key, ["management-only"]);
  const started = { userId: "user-a", epoch: cache.getAccessEpoch() };

  cache.bindPermission(client, "user-a", "employee");

  assert.equal(client.getQueryData(key), undefined);
  assert.equal(
    isAuthenticatedAccessCurrent(
      cache.getSnapshot().userId,
      cache.getAccessEpoch(),
      started,
    ),
    false,
  );
  if (
    isAuthenticatedAccessCurrent(
      cache.getSnapshot().userId,
      cache.getAccessEpoch(),
      started,
    )
  ) {
    client.setQueryData(key, ["management-only"]);
  }
  client.setQueryData(key, ["management-only"]);
  await flushMicrotasks();
  assert.equal(client.getQueryData(key), undefined);

  const currentKey = authenticatedQueryKey("user-a", ["reports", "current"]);
  client.setQueryDefaults(currentKey, {
    meta: { accessEpoch: cache.getAccessEpoch() },
  });
  client.setQueryData(currentKey, ["employee-rows"]);
  await flushMicrotasks();
  assert.deepEqual(client.getQueryData(currentKey), ["employee-rows"]);

  applyPermissionRead(cache, client, "user-a", { status: "revoked" });
  client.setQueryDefaults(currentKey, {
    meta: { accessEpoch: cache.getAccessEpoch() },
  });
  client.setQueryData(currentKey, ["employee-rows"]);
  await flushMicrotasks();
  assert.equal(client.getQueryData(currentKey), undefined);
  assert.equal(shouldRunAuthenticatedQuery("user-a", true, "revoked"), false);
  client.clear();
});

test("classifies expired sessions, network loss and discarded refreshes", () => {
  assert.equal(
    classifyAuthVerification(null, "user-a"),
    "authenticated",
  );
  assert.equal(classifyAuthVerification(null, null), "unauthenticated");
  assert.equal(
    classifyAuthVerification({ name: "AuthSessionMissingError" }, null),
    "unauthenticated",
  );
  assert.equal(
    classifyAuthVerification({ name: "AuthInvalidJwtError" }, null),
    "unauthenticated",
  );
  assert.equal(
    classifyAuthVerification({ name: "AuthApiError", status: 400 }, null),
    "unauthenticated",
  );
  assert.equal(
    classifyAuthVerification({ status: 401 }, null),
    "unauthenticated",
  );
  assert.equal(
    classifyAuthVerification({ name: "AuthRetryableFetchError" }, null),
    "unavailable",
  );
  assert.equal(
    classifyAuthVerification({ name: "AuthRefreshDiscardedError" }, null),
    "ignored",
  );
});

for (const flow of ["login", "registration"] as const) {
  test(`${flow} waits for the Auth event, identity and linked profile before becoming ready`, () => {
    const client = new QueryClient();
    const cache = createAuthenticatedQueryCache();
    const transitions = createAuthTransitionController(cache, () => client);

    const initial = transitions.beginEvent("INITIAL_SESSION", null);
    transitions.commit(
      initial,
      resolveAuthVerification(null, null, null, null),
    );
    assert.equal(cache.getSnapshot().status, "anonymous");

    const signedIn = transitions.beginEvent("SIGNED_IN", "user-a");
    assert.equal(cache.getSnapshot().status, "unverified");
    assert.equal(cache.getSnapshot().userId, null);

    transitions.commit(
      signedIn,
      resolveAuthVerification(null, "user-a", null, "user-a"),
    );
    assert.equal(cache.getSnapshot().status, "verifying_profile");
    assert.equal(
      shouldRunAuthenticatedQuery(
        cache.getSnapshot().userId,
        true,
        cache.getSnapshot().permissionStatus,
      ),
      false,
    );

    applyPermissionRead(cache, client, "user-a", {
      status: "active",
      role: "employee",
      displayName: `${flow} user`,
    });
    assert.deepEqual(cache.getSnapshot(), {
      status: "ready",
      userId: "user-a",
      permissionStatus: "active",
      role: "employee",
      displayName: `${flow} user`,
      accessEpoch: cache.getSnapshot().accessEpoch,
    });
    assert.equal(
      shouldRunAuthenticatedQuery(
        cache.getSnapshot().userId,
        true,
        cache.getSnapshot().permissionStatus,
      ),
      true,
    );
    client.clear();
  });
}

test("a stale profile result cannot complete an older Auth-event generation", () => {
  const client = new QueryClient();
  const cache = createAuthenticatedQueryCache();
  const transitions = createAuthTransitionController(cache, () => client);

  const loginA = transitions.beginEvent("SIGNED_IN", "user-a");
  transitions.commit(
    loginA,
    resolveAuthVerification(null, "user-a", null, "user-a"),
  );

  const loginB = transitions.beginEvent("SIGNED_IN", "user-b");
  applyPermissionRead(cache, client, "user-a", {
    status: "active",
    role: "management",
  });
  assert.equal(cache.getSnapshot().status, "unverified");

  assert.equal(
    transitions.commit(
      loginA,
      resolveAuthVerification(null, "user-a", null, "user-a"),
    ),
    "stale",
  );
  transitions.commit(
    loginB,
    resolveAuthVerification(null, "user-b", null, "user-b"),
  );
  applyPermissionRead(cache, client, "user-b", {
    status: "active",
    role: "employee",
  });

  assert.equal(cache.getSnapshot().status, "ready");
  assert.equal(cache.getSnapshot().userId, "user-b");
  assert.equal(cache.getSnapshot().role, "employee");
  client.clear();
});

test("an unavailable profile read suspends access and a later read recovers the same session", () => {
  const client = new QueryClient();
  const cache = createAuthenticatedQueryCache();

  cache.bindUser(client, "user-a");
  cache.bindPermission(client, "user-a", "senior", "Dr. Sattler");
  const ready = cache.getSnapshot();
  assert.equal(ready.status, "ready");

  applyPermissionRead(cache, client, "user-a", { status: "unavailable" });
  const suspended = cache.getSnapshot();
  assert.equal(suspended.status, "suspended");
  assert.equal(suspended.userId, "user-a");
  assert.equal(suspended.permissionStatus, "unavailable");
  assert.equal(suspended.role, null);
  assert.ok(suspended.accessEpoch > ready.accessEpoch);
  assert.equal(
    shouldRunAuthenticatedQuery(
      suspended.userId,
      true,
      suspended.permissionStatus,
    ),
    false,
  );

  applyPermissionRead(cache, client, "user-a", {
    status: "active",
    role: "senior",
    displayName: "Dr. Sattler",
  });
  const recovered = cache.getSnapshot();
  assert.equal(recovered.status, "ready");
  assert.equal(recovered.userId, "user-a");
  assert.equal(recovered.role, "senior");
  assert.equal(recovered.displayName, "Dr. Sattler");
  client.clear();
});

test("the authority exposes one stable immutable access snapshot", () => {
  const client = new QueryClient();
  const cache = createAuthenticatedQueryCache();
  const initial = cache.getSnapshot();

  assert.equal(cache.getSnapshot(), initial);
  assert.equal(Object.isFrozen(initial), true);

  cache.bindUser(client, "user-a");
  const verifying = cache.getSnapshot();
  assert.notEqual(verifying, initial);
  assert.equal(cache.getSnapshot(), verifying);
  assert.equal(verifying.userId, "user-a");
  assert.equal(verifying.role, null);
  assert.equal(verifying.permissionStatus, "unknown");
  client.clear();
});
