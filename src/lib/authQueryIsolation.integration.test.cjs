/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Run the real store, listener, shell, dialogs and window manager in an isolated
// module graph. Only Supabase, browser scheduling, React hooks and leaf UI are
// mocked. No network, DOM library, new dependency or production test seam.
function harness(t, initialUser = null) {
  let user = initialUser, authCallback, timerId = 0, activeRenderer;
  const timers = new Map(), modules = new Map();
  const claims = [], profiles = [];
  const calls = { claims: 0, signOut: 0, login: 0, registration: 0 };
  const profile = (role = "employee") => ({
    data: { role, display_name: `Profile ${user}` }, error: null,
  });
  const claimsResult = (id = user) => ({
    data: id ? { claims: { sub: id } } : null, error: null,
  });
  function emit(event, id = user) {
    user = id;
    authCallback(event, id ? { user: { id } } : null);
  }
  async function authenticate(credentials, flow) {
    calls[flow]++;
    const id = credentials.email.startsWith("b@") ? "user-b" : "user-a";
    emit("SIGNED_IN", id);
    return { data: { user: { id, email: credentials.email }, session: { user: { id } } }, error: null };
  }
  const supabase = {
    auth: {
      getClaims() { calls.claims++; return claims.shift() ?? Promise.resolve(claimsResult()); },
      getSession: async () => ({ data: { session: user ? { user: { id: user } } : null }, error: null }),
      onAuthStateChange(callback) {
        authCallback = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signInWithPassword: (credentials) => authenticate(credentials, "login"),
      signUp: (credentials) => authenticate(credentials, "registration"),
      async signOut() { calls.signOut++; emit("SIGNED_OUT", null); return { error: null }; },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => profiles.shift() ?? Promise.resolve(profile()) }) }) }),
  };
  const browser = {
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: () => 0, clearInterval() {}, addEventListener() {}, removeEventListener() {},
  };
  const document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const react = {
    useState: (initial) => activeRenderer.state(initial),
    useRef: (initial) => activeRenderer.ref(initial),
    useCallback: (fn, deps) => activeRenderer.memo(fn, deps),
    useEffect: (fn, deps) => activeRenderer.effect(fn, deps),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  };
  const jsx = (type, props, key) => ({ type, props, key });
  function leaf(name) {
    const component = () => null;
    Object.defineProperty(component, "name", { value: name });
    return { [name]: component };
  }
  function load(request, parent = path.join(root, "src/lib/entry.ts")) {
    if (request === "react") return react;
    if (request === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (request === "@/lib/supabase") return { getSupabaseBrowserClient: () => supabase };
    if (request === "@/lib/preferences") return {
      readLocale: () => "en", readSoundEnabled: () => true,
      subscribeLocale() {}, subscribeSound() {}, writeLocale() {}, writeSoundEnabled() {},
    };
    if (request.startsWith("@/components/") && !request.endsWith("useWindowManager")) {
      return leaf(path.basename(request));
    }
    if (!request.startsWith(".") && !request.startsWith("@/")) return require(request);
    let file = request.startsWith("@/")
      ? path.join(root, "src", request.slice(2))
      : path.resolve(path.dirname(parent), request);
    if (!path.extname(file)) file += fs.existsSync(`${file}.ts`) ? ".ts" : ".tsx";
    if (modules.has(file)) return modules.get(file).exports;
    const loadedModule = { exports: {} };
    modules.set(file, loadedModule);
    const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const execute = vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
      window: browser, document, console, queueMicrotask,
    }, { filename: file });
    execute((dependency) => load(dependency, file), loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  function renderer(component, props = {}) {
    const slots = [];
    let cursor = 0, dirty = false;
    const effects = [];
    const changed = (old, deps) => !old || deps.some((value, i) => value !== old[i]);
    const instance = {
      state(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (value) => {
          const next = typeof value === "function" ? value(slots[index]) : value;
          if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
        }];
      },
      ref(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
      memo(fn, deps) {
        const index = cursor++;
        if (changed(slots[index]?.deps, deps)) slots[index] = { fn, deps };
        return slots[index].fn;
      },
      effect(fn, deps) {
        const index = cursor++;
        if (changed(slots[index]?.deps, deps)) {
          const previous = slots[index];
          slots[index] = { deps, cleanup: previous?.cleanup };
          effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = fn(); });
        }
      },
      render() {
        let view, passes = 0;
        do {
          assert.ok(passes++ < 20, "shell must settle without a render loop");
          dirty = false; cursor = 0; activeRenderer = instance;
          view = component(props);
          effects.splice(0).forEach((effect) => effect());
        } while (dirty);
        return view;
      },
    };
    return instance;
  }
  const auth = load("./authQueryIsolation.ts");
  const qc = load("./queryClient.ts");
  const shell = renderer(load("../components/desktop/BioReserveShell.tsx").BioReserveShell);
  const stop = auth.startAuthQueryIsolation();
  t.after(() => { stop(); qc.getQueryClient().clear(); });
  function fire(delay) {
    const pending = [...timers].filter(([, timer]) => timer.delay === delay);
    for (const [id, timer] of pending) { timers.delete(id); timer.fn(); }
    return pending.length;
  }
  function seed() {
    const access = qc.getVerifiedAuthSnapshot();
    const key = ["auth-user", access.userId, "private"];
    qc.getQueryClient().setQueryDefaults(key, { meta: { accessEpoch: access.accessEpoch } });
    qc.getQueryClient().setQueryData(key, ["private-row"]);
    return key;
  }
  return { auth, qc, shell, load, renderer, emit, fire, timers, claims, profiles, calls, profile, claimsResult, seed };
}

function find(view, predicate) {
  if (!view || typeof view !== "object") return null;
  if (predicate(view)) return view;
  for (const child of [view.props?.children].flat(Infinity)) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}
function named(view, name) { return find(view, (node) => node.type?.name === name); }
async function boot(h) {
  h.shell.render().props.onContinue();
  h.shell.render(); await flush();
  h.shell.render().props.onComplete();
  return h.shell.render();
}
async function desktop(h) {
  const welcome = await boot(h);
  assert.equal(welcome.type.name, "WelcomeBackDialog");
  welcome.props.onComplete();
  h.shell.render().props.onComplete();
  assert.ok(named(h.shell.render(), "Desktop"));
}

test("boot follows replacement verification after the pending claims check is superseded by refresh", async (t) => {
  const h = harness(t, "user-a"); await flush();
  h.shell.render().props.onContinue();
  const pending = deferred(); h.claims.push(pending.promise);
  h.shell.render();
  h.emit("TOKEN_REFRESHED");
  pending.resolve(h.claimsResult()); await flush();
  h.shell.render().props.onComplete();
  h.fire(0); await flush();
  assert.equal(h.qc.getVerifiedAuthSnapshot().status, "ready");
  assert.equal(h.shell.render().type.name, "WelcomeBackDialog");
});

test("boot waits through an intermediate unverified result and resumes when the replacement becomes ready", async (t) => {
  const h = harness(t); await flush();
  h.shell.render().props.onContinue();
  const pending = deferred(); h.claims.push(pending.promise);
  h.shell.render();
  h.emit("SIGNED_IN", "user-a");
  pending.resolve(h.claimsResult(null)); await flush();
  h.shell.render().props.onComplete();
  assert.notEqual(h.shell.render().type.name, "AuthErrorScreen");
  h.fire(0); await flush();
  assert.equal(h.shell.render().type.name, "WelcomeBackDialog");
});

test("same-user token refresh retains epoch, query data and the rendered desktop", async (t) => {
  const h = harness(t, "user-a"); await flush(); await desktop(h);
  const before = h.qc.getVerifiedAuthSnapshot(); const key = h.seed();
  h.emit("TOKEN_REFRESHED");
  assert.equal(h.qc.getVerifiedAuthSnapshot(), before);
  assert.ok(named(h.shell.render(), "Desktop"));
  assert.equal(named(h.shell.render(), "LoginDialog"), null);
  assert.deepEqual(h.qc.getQueryClient().getQueryData(key), ["private-row"]);
  h.fire(0); await flush();
  assert.equal(h.qc.getVerifiedAuthSnapshot().accessEpoch, before.accessEpoch);
  assert.ok(named(h.shell.render(), "Desktop"));
  assert.equal(named(h.shell.render(), "LoginDialog"), null);
  assert.deepEqual(h.qc.getQueryClient().getQueryData(key), ["private-row"]);
});

for (const reason of ["unexpected sign-out", "session expiry"]) {
  test(`desktop navigates to a usable login UI after ${reason}`, async (t) => {
    const h = harness(t, "user-a"); await flush(); await desktop(h);
    if (reason === "unexpected sign-out") {
      h.emit("SIGNED_OUT", null);
    } else {
      h.claims.push(Promise.resolve({ data: null, error: { name: "AuthInvalidJwtError" } }));
      await h.auth.requestAuthQuerySync();
    }
    assert.equal(h.qc.getVerifiedAuthSnapshot().status, "anonymous");
    const login = h.shell.render();
    assert.equal(login.type.name, "LoginDialog");
    const dialog = h.renderer(h.load("../components/boot/LoginDialog.tsx").LoginDialog, login.props);
    const form = find(dialog.render(), (node) => node.type === "form");
    assert.equal(typeof form?.props.onSubmit, "function");
    assert.ok(find(form, (node) => node.type === "input" && node.props.type === "email"));
    assert.ok(find(form, (node) => node.type === "input" && node.props.type === "password"));
    h.fire(0); await flush();
    assert.equal(h.shell.render().type.name, "LoginDialog");
    h.emit("SIGNED_IN", "user-b");
    await login.props.onExecute("b@example.com");
    assert.equal(h.qc.getVerifiedAuthSnapshot().status, "ready");
    assert.equal(h.shell.render().type.name, "DesktopLoading");
  });
}

test("refresh with a changed identity or revoked profile still blocks access and clears data", async (t) => {
  const h = harness(t, "user-a"); await flush();
  const key = h.seed();
  h.emit("TOKEN_REFRESHED", "user-b");
  assert.equal(h.qc.getVerifiedAuthSnapshot().status, "unverified");
  assert.equal(h.qc.getQueryClient().getQueryData(key), undefined);
  h.fire(0); await flush();
  assert.equal(h.qc.getVerifiedAuthSnapshot().userId, "user-b");
  const keyB = h.seed();
  h.profiles.push(Promise.resolve({ data: null, error: null }));
  h.emit("TOKEN_REFRESHED"); h.fire(0); await flush();
  assert.equal(h.qc.getVerifiedAuthSnapshot().status, "revoked");
  assert.equal(h.qc.getQueryClient().getQueryData(keyB), undefined);
});

test("an obsolete rejection cannot schedule a retry over a newer pending profile read", async (t) => {
  const h = harness(t, "user-a"); await flush();
  const old = deferred(); h.claims.push(old.promise);
  const obsolete = h.auth.requestAuthQuerySync();
  const profile = deferred(); h.profiles.push(profile.promise);
  const current = h.auth.requestAuthQuerySync(); await flush();
  old.reject(new Error("obsolete network failure")); await obsolete;
  const calls = h.calls.claims;
  assert.equal(h.fire(50), 0);
  assert.equal(h.calls.claims, calls);
  profile.resolve(h.profile("management")); await current;
  assert.equal(h.qc.getVerifiedAuthSnapshot().role, "management");
});

test("a retry already queued before supersession cannot steal a newer generation or its retry budget", async (t) => {
  const h = harness(t, "user-a"); await flush();
  h.claims.push(Promise.reject(new Error("first failure")));
  await h.auth.requestAuthQuerySync();
  const staleTimer = [...h.timers.values()].find((timer) => timer.delay === 50);
  assert.ok(staleTimer);
  const pending = deferred(); h.claims.push(pending.promise);
  const current = h.auth.requestAuthQuerySync();
  const calls = h.calls.claims;
  staleTimer.fn(); // Simulate a callback already queued when clearTimeout ran.
  assert.equal(h.calls.claims, calls);
  pending.reject(new Error("current failure")); await current;
  assert.equal(h.fire(50), 1); await flush();
  assert.equal(h.qc.getVerifiedAuthSnapshot().status, "ready");
});

test("current retries are bounded and a fresh check gets its own budget", async (t) => {
  const h = harness(t, "user-a"); await flush();
  const failure = () => Promise.resolve().then(() => { throw new Error("offline"); });
  h.claims.push(failure()); await h.auth.requestAuthQuerySync();
  h.claims.push(failure()); assert.equal(h.fire(50), 1); await flush();
  h.claims.push(failure()); assert.equal(h.fire(50), 1); await flush();
  assert.equal(h.fire(50), 0);
  h.claims.push(failure()); await h.auth.requestAuthQuerySync();
  assert.equal(h.fire(50), 1); await flush();
  assert.equal(h.qc.getVerifiedAuthSnapshot().status, "ready");
});

for (const flow of ["login", "registration"]) {
  test(`${flow} dialog, Auth listener and shell wait for the linked profile`, async (t) => {
    const h = harness(t); await flush();
    let view = await boot(h);
    if (flow === "registration") { view.props.onCreateUser(); view = h.shell.render(); }
    const name = flow === "login" ? "LoginDialog" : "RegisterDialog";
    const dialog = h.renderer(h.load(`../components/boot/${name}.tsx`)[name], view.props);
    let form = find(dialog.render(), (node) => node.type === "form");
    const email = find(form, (node) => node.type === "input" && node.props.type === "email");
    email.props.onChange({ target: { value: "a@example.com" } });
    function fillPasswords(node) {
      if (!node || typeof node !== "object") return;
      if (node.type === "input" && node.props.type === "password") node.props.onChange({ target: { value: "test-password" } });
      for (const child of [node.props?.children].flat(Infinity)) fillPasswords(child);
    }
    fillPasswords(form);
    form = find(dialog.render(), (node) => node.type === "form");
    const profile = deferred(); h.profiles.push(profile.promise);
    form.props.onSubmit({ preventDefault() {} }); await flush();
    h.fire(0); await flush();
    assert.equal(h.calls[flow], 1);
    assert.equal(h.qc.getVerifiedAuthSnapshot().status, "verifying_profile");
    assert.equal(named(h.shell.render(), "Desktop"), null);
    profile.resolve(h.profile()); await flush();
    assert.equal(h.qc.getVerifiedAuthSnapshot().status, "ready");
    assert.equal(h.shell.render().type.name, "DesktopLoading");
  });
}

test("profile suspension and recovery remove old rows without signing out, and error presentation recovers", async (t) => {
  const h = harness(t, "user-a"); await flush(); await desktop(h);
  const key = h.seed();
  h.profiles.push(Promise.resolve({ data: null, error: { message: "offline" } }));
  await h.auth.requestAuthQuerySync();
  assert.equal(h.qc.getVerifiedAuthSnapshot().status, "suspended");
  assert.equal(h.qc.getQueryClient().getQueryData(key), undefined);
  assert.equal(h.shell.render().type.name, "AuthErrorScreen");
  await h.auth.requestAuthQuerySync();
  assert.ok(named(h.shell.render(), "Desktop"));
  assert.equal(h.qc.getQueryClient().getQueryData(key), undefined);
  assert.equal(h.calls.signOut, 0);
});

test("a restored revoked profile can recover from boot's error presentation", async (t) => {
  const h = harness(t, "user-a"); await flush();
  h.profiles.push(Promise.resolve({ data: null, error: null }));
  assert.equal((await boot(h)).type.name, "AuthErrorScreen");
  await h.auth.requestAuthQuerySync();
  assert.equal(h.shell.render().type.name, "WelcomeBackDialog");
});

test("boot suspended by a transient profile failure resumes the welcome flow after recovery", async (t) => {
  const h = harness(t, "user-a"); await flush();
  h.profiles.push(Promise.resolve({ data: null, error: { message: "offline" } }));
  const pending = await boot(h);
  assert.equal(pending.type.name, "AuthErrorScreen");
  await flush();
  assert.equal(h.qc.getVerifiedAuthSnapshot().status, "ready");
  assert.equal(h.shell.render().type.name, "WelcomeBackDialog");
  assert.equal(h.calls.signOut, 0);
});

test("account switching verifies user B, and a subsequent slow reboot preserves the welcome flow", async (t) => {
  const h = harness(t, "user-a"); await flush(); await desktop(h);
  const key = h.seed();
  const epoch = h.qc.getVerifiedAuthSnapshot().accessEpoch;
  named(h.shell.render(), "Taskbar").props.onChangeUser(); await flush();
  const login = h.shell.render();
  assert.equal(login.type.name, "LoginDialog");
  assert.equal(h.qc.getQueryClient().getQueryData(key), undefined);
  h.emit("SIGNED_IN", "user-b");
  await login.props.onExecute("b@example.com");
  h.fire(0); await flush();
  const access = h.qc.getVerifiedAuthSnapshot();
  assert.equal(access.status, "ready");
  assert.equal(access.userId, "user-b");
  assert.ok(access.accessEpoch > epoch);
  assert.equal(h.qc.getQueryClient().getQueryData(key), undefined);
  assert.equal(h.shell.render().type.name, "DesktopLoading");
  h.shell.render().props.onComplete();
  named(h.shell.render(), "Taskbar").props.onReboot();
  h.shell.render().props.onContinue();
  const profile = deferred(); h.profiles.push(profile.promise);
  h.shell.render(); await flush();
  h.shell.render().props.onComplete();
  assert.equal(named(h.shell.render(), "Desktop"), null);
  profile.resolve(h.profile()); await flush();
  assert.equal(h.shell.render().type.name, "WelcomeBackDialog");
});
