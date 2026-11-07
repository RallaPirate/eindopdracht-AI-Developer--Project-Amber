/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS DOM harness. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../..");
const REX_ID = "11111111-1111-4111-8111-111111111111";
const STEG_ID = "22222222-2222-4222-8222-222222222222";
const ORIGINAL_UPDATED_AT = "2026-03-15T14:30:45.123456Z";
const NEWER_UPDATED_AT = "2026-11-07T16:00:00.000000Z";
const SAVED_UPDATED_AT = "2026-11-07T18:04:00.654321+00:00";
const DRAFT = "DRAFT-ONLY-NOTE";

function installDom() {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const previous = new Map();
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  return {
    restore() {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      dom.window.close();
    },
  };
}

function species(id, displayName, overrides = {}) {
  return {
    id,
    display_name: displayName,
    general_description: `${displayName} description`,
    diet_preferences: `${displayName} diet`,
    habitat_preferences: `${displayName} habitat`,
    handling_guidance: `${displayName} handling`,
    minimum_handlers: 2,
    safety_class: "low",
    updated_at: ORIGINAL_UPDATED_AT,
    ...overrides,
  };
}

function createDatabase(initialRows) {
  let rows = initialRows.map((row) => ({ ...row }));
  const updates = [];
  const deferred = [];
  let defer = false;
  let nextError = null;
  let reads = 0;
  let readError = null;
  const client = {
    from(table) {
      return {
        select() {
          const query = {
            order() { return query; },
            range() { return query; },
            abortSignal() {
              reads += 1;
              if (readError) return Promise.resolve({ data: null, error: readError });
              return Promise.resolve({ data: rows.map((row) => ({ ...row })), error: null });
            },
          };
          return query;
        },
        update(payload) {
          const filters = [];
          const builder = {
            eq(column, value) {
              filters.push({ column, value });
              return builder;
            },
            select() {
              const call = {
                table,
                payload: { ...payload },
                filters: filters.map((filter) => ({ ...filter })),
              };
              updates.push(call);
              const finish = () => {
                if (nextError) {
                  const error = nextError;
                  nextError = null;
                  return { data: null, error };
                }
                const id = filters.find((filter) => filter.column === "id")?.value;
                const updatedAt = filters.find((filter) => filter.column === "updated_at")?.value;
                const index = rows.findIndex((row) => row.id === id && row.updated_at === updatedAt);
                if (index < 0) return { data: [], error: null };
                const next = {
                  ...rows[index],
                  ...payload,
                  updated_at: SAVED_UPDATED_AT,
                };
                rows[index] = next;
                return { data: [{ ...next }], error: null };
              };
              if (!defer) return Promise.resolve(finish());
              return new Promise((resolve) => {
                deferred.push((commit) => resolve(commit === false
                  ? { data: [], error: null }
                  : finish()));
              });
            },
          };
          return builder;
        },
      };
    },
  };
  return {
    client,
    updates,
    reads: () => reads,
    replace(id, patch) {
      rows = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
    },
    deferUpdates(next) { defer = next; },
    releaseUpdates(commit = true) {
      const waiting = deferred.splice(0);
      for (const resolve of waiting) resolve(commit);
    },
    failNext(error) { nextError = error; },
    failReads(error) { readError = error; },
  };
}

function loadGraph(database) {
  const modules = new Map();
  function load(request, parent = path.join(root, "src/components/programs/entry.ts")) {
    if (request === "react" || request === "react/jsx-runtime" || request === "react-dom/client") {
      return require(request);
    }
    if (request === "@tanstack/react-query") return require(request);
    if (request === "@/lib/supabase") {
      return { getSupabaseBrowserClient: () => database.client };
    }
    if (!request.startsWith(".") && !request.startsWith("@/")) return require(request);
    let file = request.startsWith("@/")
      ? path.join(root, "src", request.slice(2))
      : path.resolve(path.dirname(parent), request);
    if (!path.extname(file)) file += fs.existsSync(`${file}.ts`) ? ".ts" : ".tsx";
    if (modules.has(file)) return modules.get(file).exports;
    const loaded = { exports: {} };
    modules.set(file, loaded);
    const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const execute = vm.runInNewContext(
      `(function(require,module,exports){${compiled}\n})`,
      { window, document, console, queueMicrotask },
      { filename: file },
    );
    execute((dependency) => load(dependency, file), loaded, loaded.exports);
    return loaded.exports;
  }
  return load;
}

function text(node) {
  return node?.textContent ?? "";
}

function buttonByText(label) {
  return [...document.querySelectorAll("button")].find((node) => text(node) === label) ?? null;
}

function field(name) {
  return document.querySelector(`[name='${name}']`);
}

function grant(qc, userId, role, displayName) {
  qc.bindBrowserQueryCacheToUser(userId);
  qc.applyBrowserPermissionRead(userId, { status: "active", role, displayName });
}

async function waitFor(act, predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out\n${text(document.body).slice(0, 700)}`);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function setControl(act, element, value) {
  const prototype = element instanceof window.HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : element instanceof window.HTMLSelectElement
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
    element.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

async function runDom(rows, fn) {
  const installed = installDom();
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { QueryClientProvider } = require("@tanstack/react-query");
  const database = createDatabase(rows);
  const load = loadGraph(database);
  const qc = load("@/lib/queryClient");
  const auth = load("@/lib/authQueryIsolation");
  auth.requestFreshAuthQuerySync = async () => qc.getVerifiedAuthSnapshot();
  const client = qc.getQueryClient();
  client.setDefaultOptions({
    queries: { retry: false, retryDelay: 0, gcTime: Infinity },
    mutations: { retry: false, gcTime: Infinity },
  });
  const root = createRoot(document.getElementById("root"));
  const app = load("./SpeciesDatabaseApp.tsx");
  try {
    await fn({
      React, act, root, client, qc, auth, database, QueryClientProvider, app,
    });
  } finally {
    try {
      await act(async () => {
        root.unmount();
      });
    } finally {
      client.clear();
      client.unmount();
      installed.restore();
    }
  }
}

function renderApp(React, QueryClientProvider, client, app) {
  return React.createElement(
    QueryClientProvider,
    { client },
    React.createElement(app.SpeciesDatabaseApp),
  );
}

const rows = [
  species(REX_ID, "Amber Rex"),
  species(STEG_ID, "Amber Stegosaurus"),
];

async function showBrowser(h, userId, role, displayName) {
  const { React, act, root, client, qc, QueryClientProvider, app } = h;
  await act(async () => {
    grant(qc, userId, role, displayName);
    root.render(renderApp(React, QueryClientProvider, client, app));
  });
  await waitFor(act, () => text(document.body).includes("Amber Rex"));
}

async function openEditor(act) {
  const edit = buttonByText("Edit Species");
  assert.ok(edit);
  await act(async () => { edit.click(); });
  await waitFor(act, () => field("handling_guidance") !== null);
}

test("a confirmed rename survives failed refresh with its exact new version and sorted UUID selection", async () => {
  await runDom(rows, async (h) => {
    const { act, database, client } = h;
    await showBrowser(h, "user-senior", "senior", "Sam");
    const key = ["auth-user", "user-senior", "species-database", "list"];
    const search = document.querySelector("input");
    await setControl(act, search, "Amber Rex");
    await openEditor(act);
    await setControl(act, field("display_name"), "Zulu renamed");
    const readsBefore = database.reads();
    database.failReads({ code: "XX000", message: "secret refresh failure" });
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => buttonByText("Edit Species") !== null &&
      document.querySelector("[role='alert']") !== null);
    assert.ok(database.reads() > readsBefore, "success still triggers a list refetch");
    assert.equal(search.value, "");
    assert.equal(selectedName(), "Zulu renamed");
    assert.equal(text(document.querySelector("h2")), "Zulu renamed");
    const cached = client.getQueryData(key);
    assert.deepEqual(cached.map((row) => row.id), [STEG_ID, REX_ID]);
    assert.equal(cached[1].display_name, "Zulu renamed");
    assert.equal(cached[1].updated_at, SAVED_UPDATED_AT);
    await openEditor(act);
    assert.equal(field("display_name").value, "Zulu renamed");
    await setControl(act, field("handling_guidance"), "Updated after rename");
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => buttonByText("Edit Species") !== null);
    assert.equal(database.updates.length, 2);
    assert.deepEqual(database.updates[1].filters, [
      { column: "id", value: REX_ID },
      { column: "updated_at", value: SAVED_UPDATED_AT },
    ]);
    assert.match(text(document.body), /Updated after rename/);
    assert.equal(text(document.body).includes("may have changed"), false);
  });
});

test("a zero-row conflict neither publishes the draft nor invalidates the list", async () => {
  await runDom(rows, async (h) => {
    const { act, database, client } = h;
    await showBrowser(h, "user-senior", "senior", "Sam");
    const key = ["auth-user", "user-senior", "species-database", "list"];
    await openEditor(act);
    await setControl(act, field("display_name"), "Uncommitted rename");
    const before = client.getQueryData(key);
    const readsBefore = database.reads();
    database.replace(REX_ID, { updated_at: NEWER_UPDATED_AT });
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => buttonByText("Discard & Reload") !== null);
    assert.equal(database.updates.length, 1);
    assert.equal(database.reads(), readsBefore);
    assert.equal(client.getQueryState(key).isInvalidated, false);
    assert.equal(client.getQueryData(key), before);
    assert.equal(field("display_name").value, "Uncommitted rename");
  });
});

test("late successful updates cannot publish or invalidate after an owner or epoch change", async () => {
  for (const nextOwner of ["user-other", "user-senior"]) {
    await runDom(rows, async (h) => {
      const { act, database, client, qc } = h;
      await showBrowser(h, "user-senior", "senior", "Sam");
      await openEditor(act);
      await setControl(act, field("display_name"), "Late saved rename");
      database.deferUpdates(true);
      await act(async () => { buttonByText("Save").click(); });
      await waitFor(act, () => database.updates.length === 1);
      await act(async () => {
        if (nextOwner === "user-senior") qc.clearBrowserQueryCache();
        else grant(qc, nextOwner, "senior", "Other");
      });
      const key = ["auth-user", nextOwner, "species-database", "list"];
      await waitFor(act, () => client.getQueryData(key) !== undefined &&
        buttonByText("Edit Species") !== null);
      const currentRows = client.getQueryData(key);
      const readsBefore = database.reads();
      await act(async () => { database.releaseUpdates(); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      assert.equal(client.getQueryData(key), currentRows);
      assert.equal(client.getQueryState(key).isInvalidated, false);
      assert.equal(database.reads(), readsBefore);
      assert.equal(selectedName(), "Amber Rex");
      assert.equal(text(document.body).includes("Late saved rename"), false);
    });
  }
});

test("failed background refetch and recovery preserve the mounted draft and auth clearing", async () => {
  await runDom(rows, async (h) => {
    const { act, database, client, qc } = h;
    await showBrowser(h, "user-senior", "senior", "Sam");
    await openEditor(act);
    await setControl(act, field("handling_guidance"), DRAFT);
    const originalControl = field("handling_guidance");
    database.failReads({ code: "XX000", message: "secret read failure" });
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(act, () => document.querySelector("[role='alert']") !== null);
    assert.match(text(document.body), /Unable to complete the database operation/);
    assert.equal(text(document.body).includes("secret"), false);
    assert.equal(field("handling_guidance"), originalControl);
    assert.equal(field("handling_guidance").value, DRAFT);
    database.failReads(null);
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(act, () => document.querySelector("[role='alert']") === null);
    assert.equal(field("handling_guidance"), originalControl);
    assert.equal(field("handling_guidance").value, DRAFT);
    await act(async () => { buttonByText("Amber Stegosaurus").click(); });
    assert.ok(dialog());
    await act(async () => { grant(qc, "user-senior", "employee", "Sam"); });
    assert.equal(field("handling_guidance"), null);
    assert.equal(dialog(), null);
    assert.equal(database.updates.length, 0);
  });
});

test("failed conflict reload retains the draft and original token until reload succeeds", async () => {
  await runDom(rows, async (h) => {
    const { act, database } = h;
    await showBrowser(h, "user-senior", "senior", "Sam");
    await openEditor(act);
    await setControl(act, field("handling_guidance"), DRAFT);
    const originalControl = field("handling_guidance");
    database.replace(REX_ID, { updated_at: NEWER_UPDATED_AT, handling_guidance: "Concurrent guidance" });
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => buttonByText("Discard & Reload") !== null);
    database.failReads({ code: "XX000", message: "secret read failure" });
    await act(async () => { buttonByText("Discard & Reload").click(); });
    await waitFor(act, () => buttonByText("Discard & Reload")?.disabled === false &&
      text(document.body).includes("Unable to complete the database operation"));
    assert.equal(field("handling_guidance"), originalControl);
    assert.equal(field("handling_guidance").value, DRAFT);
    assert.equal(buttonByText("Cancel").disabled, false);
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => text(document.body).includes("may have changed"));
    assert.equal(database.updates.length, 2);
    assert.equal(database.updates[1].filters[1].value, ORIGINAL_UPDATED_AT);
    database.failReads(null);
    await act(async () => { buttonByText("Discard & Reload").click(); });
    await waitFor(act, () => field("handling_guidance")?.value === "Concurrent guidance");
    await setControl(act, field("handling_guidance"), "Reviewed guidance");
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => buttonByText("Edit Species") !== null);
    assert.equal(database.updates[2].filters[1].value, NEWER_UPDATED_AT);
  });
});

test("inconclusive fresh auth keeps the owner draft for an explicit retry without writing", async () => {
  await runDom(rows, async (h) => {
    const { act, auth, qc, database } = h;
    await showBrowser(h, "user-senior", "senior", "Sam");
    await openEditor(act);
    await setControl(act, field("handling_guidance"), DRAFT);
    const originalControl = field("handling_guidance");
    auth.requestFreshAuthQuerySync = async () => null;
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => document.querySelector("[role='alert']") !== null);
    assert.match(text(document.body), /Please try again/);
    assert.equal(field("handling_guidance"), originalControl);
    assert.equal(field("handling_guidance").value, DRAFT);
    assert.equal(buttonByText("Save").disabled, false);
    assert.equal(database.updates.length, 0);
    auth.requestFreshAuthQuerySync = async () => qc.getVerifiedAuthSnapshot();
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => buttonByText("Edit Species") !== null);
    assert.equal(database.updates.length, 1);
    assert.match(text(document.body), /DRAFT-ONLY-NOTE/);
  });
});

test("confirmed access changes clear a draft while an inconclusive fresh check is pending", async () => {
  for (const change of [
    (qc) => grant(qc, "user-senior", "employee", "Sam"),
    (qc) => grant(qc, "other-senior", "senior", "Other"),
    (qc) => qc.bindBrowserQueryCacheToUser(null),
    (qc) => qc.clearBrowserQueryCache(),
  ]) {
    await runDom(rows, async (h) => {
      const { act, auth, qc, database } = h;
      await showBrowser(h, "user-senior", "senior", "Sam");
      await openEditor(act);
      await setControl(act, field("handling_guidance"), DRAFT);
      let finish;
      auth.requestFreshAuthQuerySync = () => new Promise((resolve) => { finish = resolve; });
      await act(async () => { buttonByText("Save").click(); });
      await waitFor(act, () => finish !== undefined);
      await act(async () => { change(qc); finish(null); });
      assert.equal(field("handling_guidance"), null);
      assert.equal(text(document.body).includes(DRAFT), false);
      assert.equal(database.updates.length, 0);
      await act(async () => { grant(qc, "user-senior", "senior", "Sam"); });
      await waitFor(act, () => buttonByText("Edit Species") !== null);
      await openEditor(act);
      assert.equal(field("handling_guidance").value, "Amber Rex handling");
    });
  }
});

test("saving a local rename outside the filter reveals and retains the saved UUID", async () => {
  await runDom(rows, async (h) => {
    const { act, database } = h;
    await showBrowser(h, "user-senior", "senior", "Sam");
    const search = document.querySelector("input");
    await setControl(act, search, "Rex");
    await openEditor(act);
    await setControl(act, field("display_name"), "Zulu Rex renamed");
    await setControl(act, search, "Amber Rex");
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => buttonByText("Edit Species") !== null);
    assert.equal(database.updates.length, 1);
    assert.equal(search.value, "");
    assert.equal(selectedName(), "Zulu Rex renamed");
    assert.equal(text(document.querySelector("h2")), "Zulu Rex renamed");
    await openEditor(act);
    await setControl(act, field("handling_guidance"), "Second edit");
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => buttonByText("Edit Species") !== null);
    assert.equal(database.updates[1].filters[0].value, REX_ID);
    assert.notEqual(database.updates[1].filters[1].value, ORIGINAL_UPDATED_AT);
  });
});

test("a concurrent rename outside the filter keeps the UUID draft, conflict and navigation guard", async () => {
  await runDom(rows, async (h) => {
    const { act, client, database } = h;
    await showBrowser(h, "user-senior", "senior", "Sam");
    const search = document.querySelector("input");
    await setControl(act, search, "Rex");
    await openEditor(act);
    await setControl(act, field("handling_guidance"), DRAFT);
    const originalControl = field("handling_guidance");
    database.replace(REX_ID, { display_name: "Zulu renamed elsewhere", updated_at: NEWER_UPDATED_AT });
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(act, () => selectedName() === "Zulu renamed elsewhere");
    assert.equal(field("handling_guidance"), originalControl);
    assert.equal(field("handling_guidance").value, DRAFT);
    assert.equal(dialog(), null);
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => buttonByText("Discard & Reload") !== null);
    assert.equal(database.updates[0].filters[1].value, ORIGINAL_UPDATED_AT);
    assert.equal(field("handling_guidance").value, DRAFT);
    await setControl(act, search, "Stegosaurus");
    await act(async () => { buttonByText("Search").click(); });
    assert.ok(dialog());
    await act(async () => { buttonByText("Stay and continue editing").click(); });
    assert.equal(field("handling_guidance").value, DRAFT);
    assert.equal(selectedName(), "Zulu renamed elsewhere");
    await act(async () => { buttonByText("Search").click(); });
    await act(async () => { buttonByText("Discard changes and navigate").click(); });
    assert.equal(field("handling_guidance"), null);
    assert.equal(selectedName(), "Amber Stegosaurus");
  });
});

test("employees stay read-only and senior or management can open the populated editor", async () => {
  await runDom(rows, async (h) => {
    const { act, qc } = h;
    await showBrowser(h, "user-employee", "employee", "Eve");
    assert.equal(buttonByText("Edit Species"), null);
    assert.equal(field("display_name"), null);
    assert.match(text(document.body), /Amber Rex description/);

    await act(async () => { grant(qc, "user-employee", "senior", "Eve"); });
    await waitFor(act, () => buttonByText("Edit Species") !== null);
    await openEditor(act);
    assert.equal(field("display_name").value, "Amber Rex");
    assert.equal(field("general_description").value, "Amber Rex description");
    assert.equal(field("diet_preferences").value, "Amber Rex diet");
    assert.equal(field("habitat_preferences").value, "Amber Rex habitat");
    assert.equal(field("handling_guidance").value, "Amber Rex handling");
    assert.equal(field("minimum_handlers").value, "2");
    assert.equal(field("safety_class").value, "low");
    for (const name of ["id", "updated_at", "updated_by", "created_at", "external_species_id"]) {
      assert.equal(field(name), null);
    }
    assert.equal(buttonByText("Save").disabled, true);

    await act(async () => { grant(qc, "user-mgmt", "management", "Ada"); });
    await waitFor(act, () => buttonByText("Edit Species") !== null);
    assert.equal(field("handling_guidance"), null);
    assert.equal(text(document.body).includes(DRAFT), false);
  });
});

test("save stays closed until the draft is valid and changed, and cancel keeps the record", async () => {
  await runDom(rows, async (h) => {
    const { act, database } = h;
    await showBrowser(h, "user-senior", "senior", "Sam");
    await openEditor(act);
    assert.equal(buttonByText("Save").disabled, true);
    await setControl(act, field("display_name"), "   ");
    assert.equal(buttonByText("Save").disabled, true);
    await setControl(act, field("display_name"), "Amber Rex");
    await setControl(act, field("minimum_handlers"), "");
    assert.equal(buttonByText("Save").disabled, true);
    await setControl(act, field("minimum_handlers"), "2");
    await setControl(act, field("handling_guidance"), DRAFT);
    assert.equal(buttonByText("Save").disabled, false);
    await act(async () => { buttonByText("Cancel").click(); });
    assert.equal(field("handling_guidance"), null);
    assert.equal(text(document.body).includes(DRAFT), false);
    assert.match(text(document.body), /Amber Rex handling/);
    assert.equal(database.updates.length, 0);
    assert.equal(text(document.querySelector("[aria-current='true']")), "Amber Rex");
  });
});

test("save writes the original timestamp once, then shows the refreshed selected species", async () => {
  await runDom(rows, async (h) => {
    const { act, database } = h;
    await showBrowser(h, "user-senior", "senior", "Sam");
    await openEditor(act);
    await setControl(act, field("handling_guidance"), "Keep the north gate closed.");
    database.deferUpdates(true);
    const readsBefore = database.reads();
    await act(async () => {
      buttonByText("Save").click();
      buttonByText("Save").click();
    });
    await waitFor(act, () => database.updates.length === 1 && buttonByText("Saving…") !== null);
    assert.equal(database.updates.length, 1);
    assert.equal(buttonByText("Saving…").disabled, true);
    assert.equal(buttonByText("Cancel").disabled, true);
    assert.equal(field("handling_guidance").disabled, true);
    assert.equal(document.querySelector("[aria-label='Local species'] button").disabled, true);
    assert.equal(document.querySelector("input").disabled, true);
    assert.equal(database.updates[0].table, "species_database");
    assert.deepEqual(database.updates[0].filters, [
      { column: "id", value: REX_ID },
      { column: "updated_at", value: ORIGINAL_UPDATED_AT },
    ]);
    assert.deepEqual(database.updates[0].payload, {
      display_name: "Amber Rex",
      general_description: "Amber Rex description",
      diet_preferences: "Amber Rex diet",
      habitat_preferences: "Amber Rex habitat",
      handling_guidance: "Keep the north gate closed.",
      minimum_handlers: 2,
      safety_class: "low",
    });
    assert.equal(database.reads(), readsBefore);
    database.deferUpdates(false);
    await act(async () => { database.releaseUpdates(); });
    await waitFor(act, () => field("handling_guidance") === null && text(document.body).includes("Keep the north gate closed."));
    assert.equal(buttonByText("Edit Species") !== null, true);
    assert.equal(text(document.querySelector("[aria-current='true']")), "Amber Rex");
    assert.equal(text(document.querySelector("h2")), "Amber Rex");
    assert.equal(database.updates.length, 1);
    assert.equal(document.querySelector("input").disabled, false);
  });
});

test("a failed save keeps the draft and a conflict waits for Discard & Reload", async () => {
  await runDom(rows, async (h) => {
    const { act, database } = h;
    await showBrowser(h, "user-senior", "senior", "Sam");
    await openEditor(act);
    await setControl(act, field("handling_guidance"), DRAFT);
    database.failNext({ code: "XX000", message: "secret species_database password" });
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => document.querySelector("[role='alert']") !== null);
    assert.match(text(document.querySelector("[role='alert']")), /Unable to complete the database operation/);
    assert.equal(text(document.body).includes("secret"), false);
    assert.equal(field("handling_guidance").value, DRAFT);
    assert.equal(buttonByText("Discard & Reload"), null);
    assert.equal(database.updates.length, 1);

    database.replace(REX_ID, {
      updated_at: NEWER_UPDATED_AT,
      general_description: "Newer record.",
    });
    const readsAfterFailure = database.reads();
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => text(document.body).includes("may have changed"));
    assert.equal(field("handling_guidance").value, DRAFT);
    assert.equal(database.updates.length, 2);
    assert.equal(database.updates[1].filters[1].value, ORIGINAL_UPDATED_AT);
    assert.equal(database.reads(), readsAfterFailure);
    assert.equal(buttonByText("Discard & Reload") !== null, true);

    await act(async () => { buttonByText("Discard & Reload").click(); });
    await waitFor(act, () => field("general_description").value === "Newer record.");
    assert.equal(field("handling_guidance").value, "Amber Rex handling");
    assert.equal(text(document.body).includes(DRAFT), false);
    assert.equal(text(document.body).includes("may have changed"), false);
    assert.equal(database.updates.length, 2);
    assert.equal(database.reads(), readsAfterFailure + 1);

    await setControl(act, field("diet_preferences"), "Fish only");
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => text(document.querySelector("h2")) === "Amber Rex");
    assert.equal(database.updates.length, 3);
    assert.equal(database.updates[2].filters[1].value, NEWER_UPDATED_AT);
    assert.equal(database.updates[2].payload.diet_preferences, "Fish only");
    assert.match(text(document.body), /Fish only/);
    assert.equal(text(document.querySelector("[aria-current='true']")), "Amber Rex");
  });
});

test("a role or user change removes the editor and does not reveal the draft", async () => {
  await runDom(rows, async (h) => {
    const { act, qc, database } = h;
    await showBrowser(h, "user-senior", "senior", "Sam");
    await openEditor(act);
    await setControl(act, field("handling_guidance"), DRAFT);
    database.deferUpdates(true);
    await act(async () => { buttonByText("Save").click(); });
    await waitFor(act, () => database.updates.length === 1);
    await act(async () => { grant(qc, "user-senior", "employee", "Sam"); });
    assert.equal(field("handling_guidance"), null);
    assert.equal(buttonByText("Edit Species"), null);
    assert.equal(buttonByText("Saving…"), null);
    assert.equal(text(document.body).includes(DRAFT), false);
    assert.equal(text(document.body).includes("may have changed"), false);
    database.deferUpdates(false);
    await act(async () => { database.releaseUpdates(false); });
    await waitFor(act, () => text(document.body).includes("Amber Rex handling"));
    assert.equal(buttonByText("Edit Species"), null);
    assert.equal(text(document.body).includes(DRAFT), false);
    assert.equal(text(document.body).includes("Keep the north gate closed."), false);

    await act(async () => { grant(qc, "user-senior", "senior", "Sam"); });
    await waitFor(act, () => buttonByText("Edit Species") !== null);
    await openEditor(act);
    await setControl(act, field("handling_guidance"), DRAFT);
    await act(async () => { grant(qc, "user-other", "management", "Otto"); });
    await waitFor(act, () => text(document.body).includes("Amber Rex handling"));
    assert.equal(field("handling_guidance"), null);
    assert.equal(text(document.body).includes(DRAFT), false);
    await act(async () => { grant(qc, "user-senior", "senior", "Sam"); });
    await waitFor(act, () => buttonByText("Edit Species") !== null);
    assert.equal(text(document.body).includes(DRAFT), false);
    assert.match(text(document.body), /Amber Rex handling/);
  });
});

function dialog() {
  return document.querySelector("[role='alertdialog']");
}

function selectedName() {
  return text(document.querySelector("[aria-current='true']"));
}

function proposalTab() {
  return buttonByText("New Species Proposal");
}

test("clean and reverted drafts navigate without confirmation; dirty drafts can stay or discard", async () => {
  await runDom(rows, async (h) => {
    const { act, database } = h;
    await showBrowser(h, "user-management", "management", "Ada");
    await openEditor(act);
    await act(async () => { buttonByText("Amber Stegosaurus").click(); });
    assert.equal(dialog(), null);
    assert.equal(selectedName(), "Amber Stegosaurus");
    await openEditor(act);
    await setControl(act, field("handling_guidance"), DRAFT);
    await setControl(act, field("handling_guidance"), "Amber Stegosaurus handling");
    await act(async () => { buttonByText("Amber Rex").click(); });
    assert.equal(dialog(), null);
    await openEditor(act);
    // An invalid draft is still dirty and must be protected.
    await setControl(act, field("minimum_handlers"), "");
    await act(async () => { buttonByText("Amber Stegosaurus").click(); });
    assert.ok(dialog());
    assert.equal(selectedName(), "Amber Rex");
    await act(async () => { buttonByText("Stay and continue editing").click(); });
    assert.equal(dialog(), null);
    assert.equal(field("minimum_handlers").value, "");
    await act(async () => { buttonByText("Amber Stegosaurus").click(); });
    await act(async () => { buttonByText("Discard changes and navigate").click(); });
    assert.equal(selectedName(), "Amber Stegosaurus");
    assert.equal(field("minimum_handlers"), null);
    assert.equal(database.updates.length, 0);
    await openEditor(act);
    await setControl(act, field("handling_guidance"), DRAFT);
    await act(async () => { buttonByText("Cancel").click(); });
    assert.equal(dialog(), null);
    await openEditor(act);
    assert.equal(field("handling_guidance").value, "Amber Stegosaurus handling");
    await act(async () => { proposalTab().click(); });
    assert.equal(dialog(), null);
    assert.equal(proposalTab().getAttribute("aria-selected"), "true");
  });
});

test("proposal navigation requires a decision and discards the draft on acceptance", async () => {
  await runDom(rows, async (h) => {
    const { act } = h;
    await showBrowser(h, "user-management", "management", "Ada");
    await openEditor(act);
    await setControl(act, field("handling_guidance"), DRAFT);
    await act(async () => { proposalTab().click(); });
    assert.ok(dialog());
    assert.equal(proposalTab().getAttribute("aria-selected"), "false");
    await act(async () => { buttonByText("Stay and continue editing").click(); });
    assert.equal(field("handling_guidance").value, DRAFT);
    await act(async () => { proposalTab().click(); });
    await act(async () => { buttonByText("Discard changes and navigate").click(); });
    assert.equal(proposalTab().getAttribute("aria-selected"), "true");
    assert.equal(field("handling_guidance"), null);
    await act(async () => { buttonByText("Browse Species").click(); });
    await openEditor(act);
    assert.equal(field("handling_guidance").value, "Amber Rex handling");
  });
});

test("search applies safe filters immediately and stages hiding filters until Search or Enter", async () => {
  await runDom(rows, async (h) => {
    const { act } = h;
    await showBrowser(h, "user-senior", "senior", "Sam");
    await openEditor(act);
    await setControl(act, field("handling_guidance"), DRAFT);
    const search = document.querySelector("input[type='text']:not([name])");
    await setControl(act, search, "Rex");
    assert.equal(buttonByText("Amber Stegosaurus"), null);
    assert.equal(field("handling_guidance").value, DRAFT);
    assert.equal(dialog(), null);
    await setControl(act, search, "Steg");
    await setControl(act, search, "Stegosaurus");
    assert.equal(dialog(), null);
    assert.equal(selectedName(), "Amber Rex");
    await act(async () => { buttonByText("Search").click(); });
    assert.ok(dialog());
    await act(async () => { buttonByText("Stay and continue editing").click(); });
    assert.equal(selectedName(), "Amber Rex");
    assert.equal(field("handling_guidance").value, DRAFT);
    await act(async () => { buttonByText("Search").click(); });
    await act(async () => { buttonByText("Discard changes and navigate").click(); });
    assert.equal(selectedName(), "Amber Stegosaurus");
    assert.equal(field("handling_guidance"), null);
    await openEditor(act);
    await setControl(act, field("handling_guidance"), DRAFT);
    await setControl(act, search, "no match");
    assert.equal(dialog(), null);
    await act(async () => {
      search.closest("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => { buttonByText("Discard changes and navigate").click(); });
    assert.match(text(document.body), /No species match this search/);
    assert.equal(field("handling_guidance"), null);
    await setControl(act, search, "");
    await openEditor(act);
    // Clean filtering needs no prompt and selects the remaining species.
    await setControl(act, search, "Stegosaurus");
    assert.equal(dialog(), null);
    assert.equal(selectedName(), "Amber Stegosaurus");
    assert.equal(field("handling_guidance"), null);
  });
});

test("saving blocks tabs, search, species changes, cancel and duplicate saves", async () => {
  await runDom(rows, async (h) => {
    const { act, database } = h;
    await showBrowser(h, "user-management", "management", "Ada");
    await openEditor(act);
    await setControl(act, field("handling_guidance"), DRAFT);
    database.deferUpdates(true);
    await act(async () => {
      buttonByText("Save").click();
      // Same event batch: synchronous busy lock must already prevent navigation.
      proposalTab().click();
      buttonByText("Amber Stegosaurus").click();
      buttonByText("Cancel").click();
      buttonByText("Save").click();
    });
    await waitFor(act, () => database.updates.length === 1);
    assert.equal(proposalTab().disabled, true);
    assert.equal(buttonByText("Browse Species").disabled, true);
    assert.equal(buttonByText("Search").disabled, true);
    assert.equal(buttonByText("Cancel").disabled, true);
    assert.equal(dialog(), null);
    assert.equal(selectedName(), "Amber Rex");
    await act(async () => {
      proposalTab().click();
      buttonByText("Amber Stegosaurus").click();
      database.releaseUpdates();
    });
    await waitFor(act, () => buttonByText("Edit Species") !== null);
    assert.equal(database.updates.length, 1);
    assert.equal(proposalTab().getAttribute("aria-selected"), "false");
  });
});

test("role loss, logout and account changes discard a dirty draft and its pending decision", async () => {
  await runDom(rows, async (h) => {
    const { act, qc } = h;
    await showBrowser(h, "user-management", "management", "Ada");
    for (const change of [
      () => grant(qc, "user-management", "employee", "Ada"),
      () => grant(qc, "other-manager", "management", "Otto"),
      () => qc.bindBrowserQueryCacheToUser(null),
    ]) {
      await openEditor(act);
      await setControl(act, field("handling_guidance"), DRAFT);
      await act(async () => { proposalTab().click(); });
      assert.ok(dialog());
      await act(async () => { change(); });
      assert.equal(dialog(), null);
      assert.equal(field("handling_guidance"), null);
      assert.equal(text(document.body).includes(DRAFT), false);
      await act(async () => { grant(qc, "user-management", "management", "Ada"); });
      await waitFor(act, () => buttonByText("Edit Species") !== null);
      assert.equal(dialog(), null);
      assert.equal(field("handling_guidance"), null);
    }
  });
});

test("stale asynchronous proposal navigation cannot override a newer navigation, edit or auth epoch", async () => {
  await runDom(rows, async (h) => {
    const { act, auth, qc } = h;
    await showBrowser(h, "user-management", "management", "Ada");
    let resolve;
    auth.requestFreshAuthQuerySync = () => new Promise((done) => { resolve = done; });
    async function startTabNavigation() {
      const snapshot = qc.getVerifiedAuthSnapshot();
      await act(async () => { proposalTab().click(); });
      return { finish: resolve, snapshot };
    }
    const first = await startTabNavigation();
    await act(async () => { buttonByText("Browse Species").click(); first.finish(first.snapshot); });
    assert.equal(proposalTab().getAttribute("aria-selected"), "false");
    const second = await startTabNavigation();
    await openEditor(act);
    await setControl(act, field("handling_guidance"), DRAFT);
    await act(async () => { second.finish(second.snapshot); });
    assert.equal(proposalTab().getAttribute("aria-selected"), "false");
    assert.equal(field("handling_guidance").value, DRAFT);
    await act(async () => { buttonByText("Cancel").click(); });
    const third = await startTabNavigation();
    await act(async () => { grant(qc, "other-manager", "management", "Otto"); });
    await act(async () => { third.finish(third.snapshot); });
    assert.equal(proposalTab().getAttribute("aria-selected"), "false");
    assert.equal(field("handling_guidance"), null);
    const fourth = await startTabNavigation();
    await act(async () => { grant(qc, "other-manager", "employee", "Otto"); });
    await act(async () => { grant(qc, "other-manager", "management", "Otto"); });
    await act(async () => { fourth.finish(fourth.snapshot); });
    assert.equal(proposalTab().getAttribute("aria-selected"), "false");
  });
});
