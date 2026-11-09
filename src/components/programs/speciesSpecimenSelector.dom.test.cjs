/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS DOM harness. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../..");
const LYNX = "00000000-0000-4000-8000-0000000000a1";
const FERN = "00000000-0000-4000-8000-0000000000c1";
const BRAMBLE = "00000000-0000-4000-8000-0000000000b1";
const ASH = "00000000-0000-4000-8000-0000000000a2";
const MOSS = "00000000-0000-4000-8000-0000000000c2";
const UPDATED_AT = "2026-03-15T14:30:45.123456Z";
const READ_FAILURE = { code: "XX000", message: "secret refresh failure" };

function speciesRow(id, displayName) {
  return {
    id,
    display_name: displayName,
    general_description: `${displayName} description`,
    diet_preferences: `${displayName} diet`,
    habitat_preferences: `${displayName} habitat`,
    handling_guidance: `${displayName} handling`,
    minimum_handlers: 2,
    safety_class: "low",
    updated_at: UPDATED_AT,
  };
}

function specimenRow(id, speciesId, assetCode, nickname) {
  return {
    id,
    species_id: speciesId,
    asset_code: assetCode,
    nickname,
    status: "active",
  };
}

const SPECIES_ROWS = [
  speciesRow(LYNX, "Amber Lynx"),
  speciesRow(FERN, "Cedar Fern"),
  speciesRow(BRAMBLE, "Bramble"),
];
const SPECIMEN_ROWS = [
  specimenRow(ASH, LYNX, "RAPT-01", "Ash"),
  specimenRow(MOSS, FERN, "FERN-01", "Moss"),
];

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

function createDatabase() {
  let readError = null;
  let defer = false;
  const waiting = [];
  const calls = [];
  function respond(table, speciesId, rows) {
    calls.push({ table, speciesId });
    const payload = () => (readError
      ? { data: null, error: readError }
      : { data: rows.map((row) => ({ ...row })), error: null });
    if (!defer) return Promise.resolve(payload());
    return new Promise((resolve) => {
      waiting.push((override) => resolve(override ?? payload()));
    });
  }
  const client = {
    from(table) {
      if (table === "species_database") {
        return {
          select() {
            const query = {
              order() { return query; },
              range() { return query; },
              abortSignal() { return respond(table, null, SPECIES_ROWS); },
            };
            return query;
          },
        };
      }
      assert.equal(table, "specimens");
      return {
        select() {
          return {
            eq(_column, speciesId) {
              const query = {
                order() { return query; },
                range() { return query; },
                abortSignal() {
                  return respond(
                    table,
                    speciesId,
                    SPECIMEN_ROWS.filter((row) => row.species_id === speciesId),
                  );
                },
              };
              return query;
            },
          };
        },
      };
    },
  };
  return {
    client,
    calls,
    waiting,
    failReads(error) { readError = error; },
    deferReads(next) { defer = next; },
    releaseNext(override) {
      const resolve = waiting.shift();
      assert.ok(resolve, "no deferred read");
      resolve(override);
    },
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

function alerts() {
  return [...document.querySelectorAll("[role='alert']")];
}

function grant(qc, userId) {
  qc.bindBrowserQueryCacheToUser(userId);
  qc.applyBrowserPermissionRead(userId, {
    status: "active",
    role: "employee",
    displayName: userId,
  });
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

async function setSelect(act, element, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

async function runDom(fn) {
  const installed = installDom();
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { QueryClientProvider } = require("@tanstack/react-query");
  const database = createDatabase();
  const load = loadGraph(database);
  const qc = load("@/lib/queryClient");
  const client = qc.getQueryClient();
  client.setDefaultOptions({
    queries: { retry: false, retryDelay: 0, gcTime: Infinity },
  });
  const root = createRoot(document.getElementById("root"));
  const app = load("./SpeciesSpecimenSelector.tsx");
  const emissions = [];
  try {
    await fn({
      React, act, root, client, qc, database, QueryClientProvider, app, emissions,
    });
  } finally {
    try {
      await act(async () => { root.unmount(); });
    } finally {
      client.clear();
      client.unmount();
      installed.restore();
    }
  }
}

function renderSelector(h) {
  const { React, QueryClientProvider, client, app, emissions } = h;
  return React.createElement(
    QueryClientProvider,
    { client },
    React.createElement(app.SpeciesSpecimenSelector, {
      onChange(selection) { emissions.push({ ...selection }); },
    }),
  );
}

async function mountSelector(h, userId = "user-a") {
  const { act, root, qc } = h;
  await act(async () => {
    grant(qc, userId);
    root.render(renderSelector(h));
  });
}

async function showSelector(h, userId = "user-a") {
  await mountSelector(h, userId);
  await waitFor(h.act, () => text(document.body).includes("Amber Lynx"));
}

async function choose(act, speciesId, specimenId) {
  await setSelect(act, document.getElementById("report-species"), speciesId);
  if (specimenId) {
    await waitFor(act, () => document.getElementById("report-specimen")?.value !== undefined
      && !document.getElementById("report-specimen").disabled
      && [...document.getElementById("report-specimen").options].some((option) => option.value === specimenId));
    await setSelect(act, document.getElementById("report-specimen"), specimenId);
  }
}

test("a failed species load can be retried in place", async () => {
  await runDom(async (h) => {
    const { act, database } = h;
    database.failReads(READ_FAILURE);
    await mountSelector(h);
    await waitFor(act, () => buttonByText("Retry species list") !== null);
    assert.match(text(document.body), /Unable to complete the database operation/);
    assert.equal(text(document.body).includes("secret"), false);
    assert.equal(document.getElementById("report-species"), null);
    database.failReads(null);
    await act(async () => { buttonByText("Retry species list").click(); });
    await waitFor(act, () => document.getElementById("report-species") !== null);
    assert.equal(alerts().length, 0);
    assert.equal(document.getElementById("report-specimen").disabled, true);
  });
});

test("a failed refresh keeps the selection and reports it until retry recovers", async () => {
  await runDom(async (h) => {
    const { act, client, database, emissions } = h;
    await showSelector(h);
    await choose(act, LYNX, ASH);
    await choose(act, BRAMBLE);
    await waitFor(act, () => text(document.body).includes("A report can still cover the species"));
    await setSelect(act, document.getElementById("report-species"), LYNX);
    await waitFor(act, () => document.getElementById("report-specimen").value === "");
    await setSelect(act, document.getElementById("report-specimen"), ASH);
    const reported = emissions.length;
    assert.deepEqual(emissions.at(-1), { speciesId: LYNX, specimenId: ASH });
    database.failReads(READ_FAILURE);
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(act, () => alerts().length === 2);
    assert.match(text(document.body), /Unable to complete the database operation/);
    assert.equal(text(document.body).includes("secret"), false);
    assert.equal(document.getElementById("report-species").value, LYNX);
    assert.equal(document.getElementById("report-specimen").value, ASH);
    assert.equal(document.getElementById("report-specimen").disabled, false);
    assert.equal([...document.getElementById("report-specimen").options].some((option) => option.value === ASH), true);
    assert.equal(emissions.length, reported);
    assert.deepEqual(emissions.at(-1), { speciesId: LYNX, specimenId: ASH });
    database.failReads(null);
    await act(async () => { buttonByText("Retry specimen list").click(); });
    await waitFor(act, () => alerts().length === 1);
    assert.equal(document.getElementById("report-specimen").value, ASH);
    await act(async () => { buttonByText("Retry species list").click(); });
    await waitFor(act, () => alerts().length === 0);
    assert.equal(document.getElementById("report-species").value, LYNX);
    assert.equal(document.getElementById("report-specimen").value, ASH);
    assert.deepEqual(emissions.at(-1), { speciesId: LYNX, specimenId: ASH });
  });
});

test("a late specimen response cannot restore an earlier species or session", async () => {
  await runDom(async (h) => {
    const { act, client, qc, database, emissions } = h;
    await showSelector(h);
    await choose(act, LYNX, ASH);
    database.deferReads(true);
    await setSelect(act, document.getElementById("report-species"), FERN);
    assert.equal(document.getElementById("report-species").value, FERN);
    assert.equal(document.getElementById("report-specimen").value, "");
    assert.deepEqual(emissions.at(-1), { speciesId: FERN, specimenId: null });
    const staleLynx = {
      data: [specimenRow(ASH, LYNX, "RAPT-01", "Ash")],
      error: null,
    };
    // Authenticated queries retry failed reads. Each attempt stays deferred until released.
    const deadline = Date.now() + 2000;
    while (buttonByText("Retry specimen list") === null) {
      if (Date.now() > deadline) {
        throw new Error(`timed out\n${text(document.body).slice(0, 700)}`);
      }
      if (database.waiting.length > 0) {
        await act(async () => {
          while (database.waiting.length > 0) database.releaseNext(staleLynx);
        });
      } else {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
    }
    assert.equal(document.getElementById("report-species").value, FERN);
    assert.equal(document.getElementById("report-specimen").value, "");
    assert.equal([...emissions].some((entry, index) => index > 0
      && entry.speciesId === FERN && entry.specimenId === ASH), false);
    database.deferReads(false);
    database.failReads(null);
    await act(async () => { buttonByText("Retry specimen list").click(); });
    await waitFor(act, () => text(document.body).includes("FERN-01"));
    assert.equal(document.getElementById("report-specimen").value, "");
    assert.deepEqual(emissions.at(-1), { speciesId: FERN, specimenId: null });

    database.deferReads(true);
    await act(async () => {
      void client.invalidateQueries();
    });
    await waitFor(act, () => database.waiting.length >= 1);
    const marker = emissions.length;
    await act(async () => {
      grant(qc, "user-b");
    });
    database.deferReads(false);
    await act(async () => {
      while (database.waiting.length > 0) database.releaseNext();
    });
    await waitFor(act, () => text(document.body).includes("Amber Lynx"));
    assert.equal(document.getElementById("report-species").value, "");
    assert.equal(document.getElementById("report-specimen").value, "");
    assert.equal(document.getElementById("report-specimen").disabled, true);
    assert.ok(emissions.slice(marker).every((entry) => entry.specimenId !== ASH));
    assert.deepEqual(emissions.at(-1), { speciesId: null, specimenId: null });
  });
});
