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
// mocked. The DOM regressions below opt into real React and application UI.
function harness(t, initialUser = null, { realReact = false, components = {} } = {}) {
  let user = initialUser, authCallback, timerId = 0, activeRenderer;
  let accessToken = initialUser ? `token-${initialUser}` : null;
  const timers = new Map(), modules = new Map();
  const claims = [], sessions = [], profiles = [];
  const calls = { claims: 0, signOut: 0, login: 0, registration: 0 };
  const profile = (role = "employee") => ({
    data: { role, display_name: `Profile ${user}` }, error: null,
  });
  const claimsResult = (id = user) => ({
    data: id ? { claims: { sub: id } } : null, error: null,
  });
  function emit(event, id = user, token) {
    if (id !== user || token !== undefined) accessToken = token ?? (id ? `token-${id}` : null);
    user = id;
    authCallback(event, id ? { user: { id }, access_token: token } : null);
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
      getSession: async () => sessions.shift() ?? {
        data: { session: user ? { user: { id: user }, access_token: accessToken } : null }, error: null,
      },
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
  const browserListeners = new Map(), documentListeners = new Map();
  const browser = {
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: () => 0, clearInterval() {},
    addEventListener: (event, fn) => browserListeners.set(event, fn),
    removeEventListener: (event) => browserListeners.delete(event),
  };
  const document = {
    visibilityState: "visible",
    addEventListener: (event, fn) => documentListeners.set(event, fn),
    removeEventListener: (event) => documentListeners.delete(event),
  };
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
    if (components[request]) return components[request];
    if (request === "react") return realReact ? require("react") : react;
    if (request === "@tanstack/react-query") {
      const actual = require(request);
      if (realReact) return actual;
      return {
        ...actual,
        useQueryClient: () => load("./queryClient.ts").getQueryClient(),
        // Real TanStack execution, observer state and callback semantics;
        // only the React scheduling adapter is replaced by this harness.
        useMutation(options) {
          const [observer] = react.useState(() => new actual.MutationObserver(
            load("./queryClient.ts").getQueryClient(), { gcTime: Infinity, ...options },
          ));
          react.useEffect(() => observer.setOptions({ gcTime: Infinity, ...options }), [observer, options]);
          react.useEffect(() => observer.subscribe(() => {}), [observer]);
          return { ...observer.getCurrentResult(), mutateAsync: observer.mutate };
        },
      };
    }
    if (request === "react/jsx-runtime") return realReact ? require(request) : { jsx, jsxs: jsx };
    if (request === "@/lib/supabase") return { getSupabaseBrowserClient: () => supabase };
    if (request === "@/lib/preferences") return {
      readLocale: () => "en", readSoundEnabled: () => true,
      subscribeLocale: () => () => {}, subscribeSound: () => () => {}, writeLocale() {}, writeSoundEnabled() {},
    };
    if (request.startsWith("@/components/") && !request.endsWith("useWindowManager") &&
        !(realReact && request.startsWith("@/components/desktop/"))) {
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
    let cursor = 0, dirty = false, child;
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
        // Reconcile the protected boundary as React does: same key retains
        // its hook state; leaving the subtree or changing key discards it.
        const protectedView = named(view, "ProtectedDesktop");
        if (protectedView) {
          if (!child || child.key !== protectedView.key) {
            child = { key: protectedView.key, renderer: renderer(protectedView.type, protectedView.props) };
          }
          if (qc.getVerifiedAuthSnapshot().status !== "ready") return named(view, "AuthErrorScreen");
          Object.assign(child.renderer.props, protectedView.props);
          return child.renderer.render();
        }
        child = undefined;
        return view;
      },
      props,
    };
    return instance;
  }
  const auth = load("./authQueryIsolation.ts");
  const qc = load("./queryClient.ts");
  const Shell = load("../components/desktop/BioReserveShell.tsx").BioReserveShell;
  const shell = renderer(Shell);
  const stop = auth.startAuthQueryIsolation();
  t.after(() => { stop(); if (!realReact) qc.getQueryClient().clear(); });
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
  function visibility(state) {
    document.visibilityState = state;
    documentListeners.get("visibilitychange")?.();
  }
  const dispatchBrowser = (event, value) => browserListeners.get(event)?.(value);
  return { auth, qc, shell, Shell, load, renderer, emit, fire, visibility, dispatchBrowser, timers, claims, sessions, profiles, calls, profile, claimsResult, seed };
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

// Real React DOM reconciliation, Activity, Suspense, events and hook lifetimes.
// JSDOM does not implement browser inert hit testing; assertions cover the native
// hidden/inert/a11y attributes AND rejection of synthetic events at capture.
async function domHarness(t) {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const previous = new Map();
  for (const [name, value] of Object.entries({
    window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { QueryClientProvider } = require("@tanstack/react-query");
  const e = React.createElement;
  const counts = { instances: 0, ticks: 0, submits: 0, keys: 0, reads: 0, blockedRenders: 0 };
  let h, latestTaskbar;
  function DraftForm() {
    const [instance] = React.useState(() => ++counts.instances);
    const [value, setValue] = React.useState("");
    const [selected, setSelected] = React.useState("record-a");
    React.useEffect(() => {
      const tick = () => { counts.ticks++; };
      dom.window.addEventListener("protected-tick", tick);
      return () => dom.window.removeEventListener("protected-tick", tick);
    }, []);
    return e("form", {
      "data-instance": instance,
      onSubmit: (event) => { event.preventDefault(); counts.submits++; },
      onKeyDown: () => { counts.keys++; },
    }, e("input", { "aria-label": "Draft", value, onChange: (event) => setValue(event.target.value) }),
    e("select", { "aria-label": "Selected record", value: selected, onChange: (event) => setSelected(event.target.value) },
      e("option", { value: "record-a" }, "A"), e("option", { value: "record-b" }, "B")),
    e("button", { type: "submit" }, "Save"));
  }
  function ProgramContent({ id }) {
    if (h.qc.getVerifiedAuthSnapshot().status !== "ready") counts.blockedRenders++;
    const hooks = h.load("../hooks/useAuthenticatedQuery.ts");
    // Keep actual authenticated observers mounted across cache cancellation.
    hooks.useAuthenticatedQuery({
      queryKey: ["dom-regression", id],
      queryFn: async () => { counts.reads++; return ["record"]; },
    });
    return e(DraftForm);
  }
  const components = { "@/components/programs/ProgramContent": { ProgramContent } };
  for (const [name, callback] of [
    ["FullscreenPrompt", "onContinue"], ["BootSequence", "onComplete"],
    ["WelcomeBackDialog", "onComplete"], ["DesktopLoading", "onComplete"],
  ]) {
    components[`@/components/boot/${name}`] = {
      [name]: (props) => e("button", { onClick: props[callback] }, name),
    };
  }
  components["@/components/boot/LoginDialog"] = {
    LoginDialog: (props) => e("button", { onClick: () => props.onExecute("a@example.com") }, "Login"),
  };
  components["@/components/desktop/Taskbar"] = {
    Taskbar: (props) => {
      latestTaskbar = props;
      return e("button", { onClick: props.onChangeUser }, "Logout");
    },
  };
  h = harness(t, "user-a", { realReact: true, components });
  h.qc.getQueryClient().setDefaultOptions({ queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } });
  const container = dom.window.document.getElementById("root");
  const root = createRoot(container);
  const act = async (fn = () => {}) => React.act(async () => { await fn(); await flush(); });
  t.after(async () => {
    await act(() => root.unmount());
    h.qc.getQueryClient().clear();
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  await act(() => root.render(e(QueryClientProvider, { client: h.qc.getQueryClient() }, e(h.Shell))));
  const button = (text) => [...container.querySelectorAll("button")].find((node) => node.textContent === text);
  const click = async (text) => {
    assert.ok(button(text), `button ${text} exists`);
    await act(() => button(text).click());
  };
  for (const name of ["FullscreenPrompt", "BootSequence", "WelcomeBackDialog", "DesktopLoading"]) await click(name);
  const draft = () => container.querySelector("input[aria-label='Draft']");
  const input = async (value) => act(() => {
    // Invoke the native setter so React's value tracker detects a user edit.
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(draft(), value);
    draft().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  const tick = () => dom.window.dispatchEvent(new dom.window.Event("protected-tick"));
  return { ...h, dom, container, act, click, draft, input, tick, counts, taskbar: () => latestTaskbar };
}

test("React DOM: repeated same-user tab recovery preserves windows, focus and unsaved form instances", async (t) => {
  const h = await domHarness(t);
  await h.click("Reports.exe");
  await h.click("Archive.exe");
  await h.act(() => {
    // Exercise the real Window drag handlers and useWindowManager positions.
    const titlebar = h.container.querySelector("[aria-label='Close Reports.exe']").parentElement;
    titlebar.dispatchEvent(new h.dom.window.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 85, clientY: 53 }));
    h.dispatchBrowser("mousemove", { clientX: 235, clientY: 125 });
    // Leave the drag active: hiding Activity must clean up its global handlers.
  });
  const reportWindow = h.taskbar().windows.find((win) => win.id === "reports");
  assert.equal(reportWindow.x, 230);
  assert.equal(reportWindow.y, 120);
  assert.equal(h.taskbar().activeId, "reports");
  assert.ok(reportWindow.zIndex > h.taskbar().windows.find((win) => win.id === "archive").zIndex);
  await h.input("Unsubmitted field notes");
  await h.act(() => {
    const select = h.container.querySelector("select");
    select.value = "record-b";
    select.dispatchEvent(new h.dom.window.Event("change", { bubbles: true }));
  });
  const original = h.draft(), form = original.closest("form");
  const before = h.taskbar().windows;
  const active = h.taskbar().activeId;
  const mounts = h.counts.instances;
  for (let i = 0; i < 3; i++) {
    const epoch = h.qc.getVerifiedAuthSnapshot().accessEpoch;
    await h.act(() => { h.visibility("hidden"); h.visibility("visible"); });
    // A SIGNED_IN event without a token still takes the strict path.
    await h.act(() => {
      h.emit("SIGNED_IN");
      // Events arriving before React commits concealment must also be blocked.
      form.dispatchEvent(new h.dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    const boundary = h.container.querySelector("[inert]");
    assert.ok(boundary?.hidden);
    assert.equal(boundary.getAttribute("aria-hidden"), "true");
    assert.match(h.container.textContent, /Protected access is suspended/);
    assert.equal(h.qc.getVerifiedAuthSnapshot().status, "unverified");
    const ticks = h.counts.ticks, reads = h.counts.reads;
    h.tick();
    assert.equal(h.counts.ticks, ticks, "hidden Activity disconnected effect subscriptions");
    await h.act(() => {
      original.dispatchEvent(new h.dom.window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      form.dispatchEvent(new h.dom.window.Event("submit", { bubbles: true, cancelable: true }));
      h.container.querySelector("button").click();
      h.dispatchBrowser("mousemove", { clientX: 900, clientY: 900 });
    });
    assert.equal(h.counts.keys, 0);
    assert.equal(h.counts.submits, 0);
    assert.equal(h.counts.reads, reads, "no authenticated fetch while unverified");
    assert.equal(h.counts.blockedRenders, 0, "the verification gate preserves the paused application tree");
    await h.act(() => h.fire(0));
    assert.equal(h.qc.getVerifiedAuthSnapshot().status, "ready");
    assert.ok(h.qc.getVerifiedAuthSnapshot().accessEpoch > epoch);
    assert.equal(h.container.querySelector("[inert]"), null);
    assert.equal(h.draft(), original, "the same input DOM node survives");
    assert.equal(h.draft().closest("form"), form);
    assert.equal(h.draft().value, "Unsubmitted field notes");
    assert.equal(h.container.querySelector("select").value, "record-b");
    assert.equal(h.counts.instances, mounts, "form state initializers did not run again");
    assert.deepEqual(h.taskbar().windows, before);
    assert.equal(h.taskbar().activeId, active);
    const resumedTicks = h.counts.ticks;
    h.tick();
    assert.ok(h.counts.ticks > resumedTicks);
    const readyEpoch = h.qc.getVerifiedAuthSnapshot().accessEpoch;
    await h.act(() => { h.emit("TOKEN_REFRESHED"); h.fire(0); });
    assert.equal(h.qc.getVerifiedAuthSnapshot().accessEpoch, readyEpoch);
    assert.equal(h.draft(), original);
    assert.equal(h.draft().value, "Unsubmitted field notes");
    assert.deepEqual(h.taskbar().windows, before);
  }
  // Fast verification must preserve the same instance even if React never
  // commits the intermediate unverified snapshot.
  await h.act(() => { h.emit("SIGNED_IN"); h.fire(0); });
  assert.equal(h.draft(), original);
  assert.equal(h.counts.instances, mounts);
  assert.deepEqual(h.taskbar().windows, before);
});

for (const transition of ["logout then same account", "account switch", "revocation", "role change during verification"]) {
  test(`React DOM: ${transition} destroys protected presentation and drafts`, async (t) => {
    const h = await domHarness(t);
    await h.click("Reports.exe"); await h.input("Private draft");
    const original = h.draft();
    const lifetime = h.qc.getVerifiedAuthSnapshot().presentation.id;
    if (transition === "logout then same account") {
      // Include all transitions in one React batch so no intermediate render
      // can be relied upon to notice the signed-out state.
      await h.act(() => { h.emit("SIGNED_OUT", null); h.emit("SIGNED_IN", "user-a"); h.fire(0); });
    } else if (transition === "account switch") {
      await h.act(() => { h.emit("SIGNED_IN", "user-b"); h.fire(0); });
    } else if (transition === "revocation") {
      h.profiles.push(Promise.resolve({ data: null, error: null }));
      await h.act(() => { h.emit("SIGNED_IN"); h.fire(0); });
      assert.equal(h.qc.getVerifiedAuthSnapshot().presentation, null);
      assert.equal(original.isConnected, false);
      await h.act(() => h.auth.requestAuthQuerySync());
    } else {
      h.profiles.push(Promise.resolve(h.profile("management")));
      await h.act(() => { h.emit("SIGNED_IN"); h.fire(0); });
    }
    assert.equal(original.isConnected, false);
    assert.notEqual(h.qc.getVerifiedAuthSnapshot().presentation.id, lifetime);
    assert.equal(h.draft(), null);
    assert.equal(h.taskbar().windows.length, 0);
    assert.equal(h.taskbar().activeId, null);
    await h.click("Reports.exe");
    assert.equal(h.draft().value, "");
    assert.notEqual(h.draft(), original);
  });
}
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
  h.shell.render(); await flush();
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
  h.shell.render(); await flush();
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

test("visibility recovery of the verified Management token keeps the epoch and cache", async (t) => {
  const h = harness(t, "user-a");
  h.profiles.push(Promise.resolve(h.profile("management")));
  await flush();
  const before = h.qc.getVerifiedAuthSnapshot(), key = h.seed();
  const claimsBefore = h.calls.claims;
  const profileRead = deferred();
  h.profiles.push(profileRead.promise);

  h.visibility("hidden");
  h.visibility("visible");
  h.emit("SIGNED_IN", "user-a", "token-user-a");
  assert.equal(h.qc.getVerifiedAuthSnapshot(), before);
  h.fire(0);
  await flush();
  assert.equal(h.calls.claims, claimsBefore + 1);
  assert.equal(h.qc.getVerifiedAuthSnapshot(), before);

  profileRead.resolve(h.profile("management"));
  await flush();
  assert.equal(h.qc.getVerifiedAuthSnapshot(), before);
  assert.deepEqual(h.qc.getQueryClient().getQueryData(key), ["private-row"]);
});

for (const [label, userId, token] of [
  ["a new session for the same account", "user-a", "new-token-user-a"],
  ["a different account", "user-b", "token-user-b"],
  ["an event without a token", "user-a", undefined],
]) {
  test(`SIGNED_IN for ${label} immediately invalidates old access`, async (t) => {
    const h = harness(t, "user-a"); await flush();
    const before = h.qc.getVerifiedAuthSnapshot(), key = h.seed();
    h.emit("SIGNED_IN", userId, token);
    assert.equal(h.qc.getVerifiedAuthSnapshot().status, "unverified");
    assert.ok(h.qc.getVerifiedAuthSnapshot().accessEpoch > before.accessEpoch);
    assert.equal(h.qc.getQueryClient().getQueryData(key), undefined);
    h.fire(0); await flush();
    assert.equal(h.qc.getVerifiedAuthSnapshot().userId, userId);
  });
}

for (const [label, read, status] of [
  ["a downgrade", (h) => h.profile("employee"), "ready"],
  ["revocation", () => ({ data: null, error: null }), "revoked"],
  ["an unavailable profile", () => ({ data: null, error: {} }), "suspended"],
]) {
  test(`matching-token recovery invalidates Management access after ${label}`, async (t) => {
    const h = harness(t, "user-a");
    h.profiles.push(Promise.resolve(h.profile("management")));
    await flush();
    const before = h.qc.getVerifiedAuthSnapshot(), key = h.seed();
    h.profiles.push(Promise.resolve(read(h)));
    h.emit("SIGNED_IN", "user-a", "token-user-a");
    h.fire(0); await flush();
    const after = h.qc.getVerifiedAuthSnapshot();
    assert.equal(after.status, status);
    assert.notEqual(after.role, "management");
    assert.ok(after.accessEpoch > before.accessEpoch);
    assert.equal(h.qc.getQueryClient().getQueryData(key), undefined);
  });
}

test("a superseding visibility check still invalidates recovery if claims are unavailable", async (t) => {
  const h = harness(t, "user-a"); await flush();
  const before = h.qc.getVerifiedAuthSnapshot(), key = h.seed();
  h.emit("SIGNED_IN", "user-a", "token-user-a");
  h.claims.push(Promise.resolve({ data: null, error: { name: "AuthRetryableFetchError" } }));
  h.visibility("hidden");
  h.visibility("visible");
  h.fire(0); await flush();
  assert.equal(h.qc.getVerifiedAuthSnapshot().status, "unverified");
  assert.ok(h.qc.getVerifiedAuthSnapshot().accessEpoch > before.accessEpoch);
  assert.equal(h.qc.getQueryClient().getQueryData(key), undefined);
});

test("matching-token recovery invalidates access if the active token changes during verification", async (t) => {
  const h = harness(t, "user-a"); await flush();
  const before = h.qc.getVerifiedAuthSnapshot(), key = h.seed();
  h.emit("SIGNED_IN", "user-a", "token-user-a");
  h.sessions.push(
    { data: { session: { user: { id: "user-a" }, access_token: "token-user-a" } }, error: null },
    { data: { session: { user: { id: "user-a" }, access_token: "new-token-user-a" } }, error: null },
  );
  h.fire(0); await flush();
  assert.equal(h.qc.getVerifiedAuthSnapshot().status, "unverified");
  assert.ok(h.qc.getVerifiedAuthSnapshot().accessEpoch > before.accessEpoch);
  assert.equal(h.qc.getQueryClient().getQueryData(key), undefined);
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
  const obsolete = h.auth.requestAuthQuerySync(); await flush();
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

function mutationHook(h, options) {
  const { useAuthenticatedMutation } = h.load("../hooks/useAuthenticatedQuery.ts");
  return h.renderer(() => useAuthenticatedMutation(options));
}

test("overlapping mutations retain their original epochs and cannot remove newer cached data", async (t) => {
  const h = harness(t, "user-a"); await flush();
  const old = deferred(), fresh = deferred(), callbacks = [];
  const hook = mutationHook(h, {
    mutationFn: (value) => value === "old" ? old.promise : fresh.promise,
    onSuccess: (data, value) => callbacks.push([data, value]),
    onError: () => callbacks.push("error"),
    onSettled: () => callbacks.push("settled"),
  });
  const oldPromise = hook.render().mutateAsync("old", {
    onError: () => callbacks.push("per-call error"),
    onSettled: () => callbacks.push("per-call settled"),
  });
  const rejected = assert.rejects(oldPromise, { name: "AuthenticatedQueryIdentityError" });
  await flush();
  h.qc.clearBrowserQueryCache();
  const key = h.seed();
  const freshPromise = hook.render().mutateAsync("fresh");
  await flush();
  old.resolve("private old result"); await rejected;
  assert.equal(callbacks.length, 0);
  assert.deepEqual(h.qc.getQueryClient().getQueryData(key), ["private-row"]);
  fresh.resolve("fresh result");
  assert.equal(await freshPromise, "fresh result");
  assert.deepEqual(callbacks, [["fresh result", "fresh"], "settled"]);
});

test("completed mutation data and optimistic context disappear after access changes", async (t) => {
  const h = harness(t, "user-a"); await flush();
  const hook = mutationHook(h, {
    mutationFn: async () => "permission-sensitive result",
    onMutate: () => ({ privateDraft: "old" }),
  });
  await hook.render().mutateAsync();
  assert.equal(hook.render().data, "permission-sensitive result");
  h.qc.clearBrowserQueryCache();
  const after = hook.render();
  assert.equal(after.data, undefined);
  assert.equal(after.context, undefined);
  assert.equal(after.variables, undefined);
  assert.equal(after.isIdle, true);
  assert.equal(hook.render().data, undefined);
});

test("ordinary mutate and mutateAsync preserve variables, optimistic context and callback arguments", async (t) => {
  const h = harness(t, "user-a"); await flush();
  const variable = { title: "new" }, optimistic = { previous: "row" }, calls = [];
  const verify = (data, variables, context, execution) => {
    assert.equal(data, "saved"); assert.equal(variables, variable);
    assert.equal(context, optimistic);
    assert.equal(execution.client, undefined);
    assert.equal(execution.userId, "user-a");
    assert.equal(typeof execution.cache.setQueryData, "function");
    calls.push("success");
  };
  const hook = mutationHook(h, {
    mutationFn: async (variables, context) => {
      assert.equal(variables, variable); assert.equal(context.userId, "user-a"); return "saved";
    },
    onMutate: (variables) => { assert.equal(variables, variable); return optimistic; },
    onSuccess: verify,
  });
  assert.equal(await hook.render().mutateAsync(variable, { onSuccess: verify }), "saved");
  assert.equal(hook.render().variables, variable);
  assert.equal(hook.render().context, optimistic);
  assert.equal(hook.render().mutate(variable, { onSuccess: verify }), undefined);
  await flush();
  assert.equal(calls.length, 4);
});

test("stale pending mutations and retained mutate functions cannot invoke application callbacks", async (t) => {
  const h = harness(t, "user-a"); await flush();
  const pending = deferred(); let callbacks = 0, writes = 0;
  const hook = mutationHook(h, {
    mutationFn: () => { writes++; return pending.promise; },
    onSuccess: () => callbacks++, onError: () => callbacks++, onSettled: () => callbacks++,
  });
  const oldResult = hook.render();
  oldResult.mutate(undefined, {
    onSuccess: () => callbacks++, onError: () => callbacks++, onSettled: () => callbacks++,
  });
  await flush();
  h.emit("SIGNED_OUT", null);
  pending.resolve("private"); await flush();
  assert.equal(callbacks, 0);
  assert.equal(hook.render().data, undefined);
  await assert.rejects(oldResult.mutateAsync(), { name: "AuthenticatedQueryIdentityError" });
  assert.equal(writes, 1);
});

for (const event of ["SIGNED_OUT", "SIGNED_IN", "permission change"]) {
  test(`protected windows are discarded after ${event}, even when verification finishes between renders`, async (t) => {
    const h = harness(t, "user-a"); await flush(); await desktop(h);
    named(h.shell.render(), "Desktop").props.onOpenProgram("reports");
    assert.equal(named(h.shell.render(), "Desktop").props.windows.length, 1);
    if (event === "permission change") {
      h.qc.applyBrowserPermissionRead("user-a", { status: "active", role: "management" });
    } else {
      h.emit(event, event === "SIGNED_OUT" ? null : "user-b");
      h.fire(0); await flush();
    }
    if (event === "SIGNED_OUT") {
      const login = h.shell.render();
      assert.equal(login.type.name, "LoginDialog");
      h.emit("SIGNED_IN", "user-b"); await login.props.onExecute("b@example.com");
      h.shell.render().props.onComplete();
    }
    const after = named(h.shell.render(), "Desktop");
    assert.ok(after);
    assert.equal(after.props.windows.length, 0);
    assert.equal(after.props.activeId, null);
  });
}

test("routine token refresh retains open windows, positions, completed mutation and cache", async (t) => {
  const h = harness(t, "user-a"); await flush(); await desktop(h);
  named(h.shell.render(), "Desktop").props.onOpenProgram("reports");
  named(h.shell.render(), "Desktop").props.onMoveWindow("reports", 230, 120);
  const windows = named(h.shell.render(), "Desktop").props.windows;
  const key = h.seed();
  const hook = mutationHook(h, { mutationFn: async () => "saved" });
  await hook.render().mutateAsync();
  const epoch = h.qc.getVerifiedAuthSnapshot().accessEpoch;
  h.emit("TOKEN_REFRESHED"); h.fire(0); await flush();
  assert.equal(h.qc.getVerifiedAuthSnapshot().accessEpoch, epoch);
  assert.equal(named(h.shell.render(), "Desktop").props.windows, windows);
  assert.equal(named(h.shell.render(), "Desktop").props.activeId, "reports");
  assert.equal(hook.render().data, "saved");
  assert.deepEqual(h.qc.getQueryClient().getQueryData(key), ["private-row"]);
});

// Exercise the actual hook + TanStack observer, not a standalone guard helper.
for (const location of ["hook", "per-call"]) {
  for (const phase of ["onMutate", "onSuccess", "onError", "onSettled"]) {
    if (location === "per-call" && phase === "onMutate") continue;
    test(`async ${location} ${phase} cannot overwrite Employee data after Management access ends`, async (t) => {
      const h = harness(t, "user-a"); await flush();
      h.qc.applyBrowserPermissionRead("user-a", { status: "active", role: "management" });
      h.seed();
      const started = deferred(), resume = deferred(), finished = deferred();
      let context, callbackError;
      const callback = async (...args) => {
        try {
          context = args.at(-1);
          assert.equal(context.client, undefined, "raw QueryClient is no longer exposed");
          started.resolve();
          await resume.promise;
          // This used to be context.client.setQueryData on the same user's
          // newly-created Employee query. The supported capability must check
          // NOW, not just before entering or after awaiting this callback.
          context.cache.setQueryData(["private"], ["Management-only data"]);
          await context.cache.invalidateQueries(["private"]);
          return { optimistic: "old Management context" };
        } catch (error) { callbackError = error; }
        finally { finished.resolve(); }
      };
      const options = {
        mutationFn: async () => {
          if (phase === "onError") throw new Error("server operation failed");
          return "Management mutation result";
        },
        ...(location === "hook" ? { [phase]: callback } : {}),
      };
      const hook = mutationHook(h, options);
      const promise = hook.render().mutateAsync(undefined,
        location === "per-call" ? { [phase]: callback } : undefined);
      // Per-call callbacks retain TanStack's fire-and-forget semantics; attach
      // a rejection handler immediately, whether or not the promise has settled.
      const outcome = promise.then((data) => ({ data }), (error) => ({ error }));
      await started.promise;
      h.qc.applyBrowserPermissionRead("user-a", { status: "active", role: "employee" });
      const key = h.seed();
      h.qc.getQueryClient().setQueryData(key, ["Employee-safe data"]);
      resume.resolve(); await finished.promise; await outcome; await flush();
      assert.equal(callbackError, undefined);
      assert.deepEqual(h.qc.getQueryClient().getQueryData(key), ["Employee-safe data"]);
      assert.equal(h.qc.getQueryClient().getQueryState(key).isInvalidated, false);
      assert.equal(hook.render().data, undefined);
    });
  }
}

test("current-epoch callback capabilities update scoped cache data and invalidate queries", async (t) => {
  const h = harness(t, "user-a"); await flush();
  const key = h.seed(), optimistic = { previous: "row" };
  let execution;
  const hook = mutationHook(h, {
    mutationFn: async () => "saved",
    onMutate: async (_variables, context) => {
      await flush();
      context.cache.setQueryData(["private"], ["optimistic"]);
      return optimistic;
    },
    onSuccess: async (_data, _variables, result, context) => {
      assert.equal(result, optimistic);
      execution = context;
      await flush();
      context.cache.setQueryData(["private"], ["confirmed"]);
      await context.cache.invalidateQueries(["private"]);
    },
  });
  assert.equal(await hook.render().mutateAsync(), "saved");
  assert.deepEqual(h.qc.getQueryClient().getQueryData(key), ["confirmed"]);
  assert.equal(h.qc.getQueryClient().getQueryState(key).isInvalidated, true);
  assert.equal(execution.client, undefined);
  let updaterRan = false;
  assert.throws(() => execution.cache.setQueryData(["private"], () => { updaterRan = true; }), { name: "TypeError" });
  assert.equal(updaterRan, false);
  execution.cache.setQueryData(["missing"], ["must refetch instead"]);
  assert.equal(h.qc.getQueryClient().getQueryData(["auth-user", "user-a", "missing"]), undefined);
});
