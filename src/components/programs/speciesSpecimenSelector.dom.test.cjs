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

function createDatabase(readDraftPage) {
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
      if (table === "reports") {
        const request = { table, filters: [], orders: [] };
        const query = {
          select(columns) { request.columns = columns; return query; },
          eq(...filter) { request.filters.push(filter); return query; },
          order(column, { ascending }) { request.orders.push([column, ascending]); return query; },
          range(...range) { request.range = range; return query; },
          abortSignal(signal) { return readDraftPage({ ...request, signal }); },
        };
        return query;
      }
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

function grant(qc, userId, role = "employee") {
  qc.bindBrowserQueryCacheToUser(userId);
  qc.applyBrowserPermissionRead(userId, {
    status: "active",
    role,
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

async function runDom(fn, readDraftPage) {
  const installed = installDom();
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { QueryClientProvider } = require("@tanstack/react-query");
  const database = createDatabase(readDraftPage);
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
      React, act, root, client, qc, database, QueryClientProvider, app, emissions, load,
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

function renderReports({ React, QueryClientProvider, client, load }) {
  const { ReportsApp } = load("./ReportsApp.tsx");
  return React.createElement(QueryClientProvider, { client }, React.createElement(ReportsApp));
}

function draftRow(index, fields = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    species_id: LYNX,
    title: `Draft ${index}`,
    report_type: "care",
    updated_at: UPDATED_AT,
    ...fields,
  };
}

function draftRegion() {
  return document.querySelector("section[aria-label='My drafts']");
}

test("Reports lists ordered draft pages with nullable fields and keeps the subject selector usable", async () => {
  const requests = [];
  const recent = draftRow(1, { updated_at: "2026-11-09T13:00:00+01:00" });
  const older = draftRow(1001, { title: null, report_type: null });
  await runDom(async (h) => {
    await h.act(async () => {
      grant(h.qc, "user-a");
      h.root.render(renderReports(h));
    });
    await waitFor(h.act, () => draftRegion()?.querySelectorAll("li").length === 1001);
    const rows = draftRegion().querySelectorAll("li");
    assert.equal(text(rows[0].querySelector("p")), "Draft 1");
    assert.match(text(rows[0]), /care · Updated/);
    assert.equal(rows[0].querySelector("time").dateTime, recent.updated_at);
    assert.equal(text(rows[1000].querySelector("p")), "Untitled draft");
    assert.match(text(rows[1000]), /No type set · Updated/);
    assert.equal(rows[1000].querySelector("time").dateTime, older.updated_at);

    assert.deepEqual(requests.map(({ range }) => range), [[0, 999], [1000, 1999]]);
    for (const request of requests) {
      assert.equal(request.table, "reports");
      assert.equal(request.columns, "id, title, report_type, species_id, updated_at");
      assert.deepEqual(request.filters, [["review_status", "draft"], ["record_status", "active"]]);
      assert.deepEqual(request.orders, [["updated_at", false], ["id", true]]);
      assert.ok(request.signal instanceof AbortSignal);
    }

    await choose(h.act, LYNX, ASH);
    assert.equal(document.getElementById("report-species").value, LYNX);
    assert.equal(document.getElementById("report-specimen").value, ASH);
    assert.equal(draftRegion().querySelectorAll("li").length, 1001);
  }, (request) => {
    requests.push(request);
    const data = request.range[0] === 0
      ? [recent, ...Array.from({ length: 999 }, (_, index) => draftRow(index + 2))]
      : [older];
    return Promise.resolve({ data, error: null });
  });
});

test("Reports distinguishes database and payload failures from an empty list and can retry", async () => {
  let response = { data: null, error: READ_FAILURE };
  await runDom(async (h) => {
    await h.act(async () => {
      grant(h.qc, "user-a");
      h.root.render(renderReports(h));
    });
    await waitFor(h.act, () => buttonByText("Retry draft list") !== null);
    assert.match(text(draftRegion()), /Unable to complete the database operation/);
    assert.doesNotMatch(text(draftRegion()), /secret|No drafts yet/);

    response = { data: [draftRow(1, { updated_at: "invalid date" })], error: null };
    await h.act(async () => { buttonByText("Retry draft list").click(); });
    await waitFor(h.act, () => text(draftRegion()).includes("The provided input is invalid."));
    assert.doesNotMatch(text(draftRegion()), /No drafts yet/);

    response = { data: [], error: null };
    await h.act(async () => { buttonByText("Retry draft list").click(); });
    await waitFor(h.act, () => text(draftRegion()).includes("No drafts yet."));
    assert.equal(draftRegion().querySelector("[role='alert']"), null);
  }, () => Promise.resolve(response));
});

test("Reports waits for verified access and drops prior drafts and late results across account changes", async () => {
  const requests = [];
  const ownDraftKey = (user) => ["auth-user", user, "reports", "own-drafts"];
  let loadPage = () => Promise.resolve({ data: [draftRow(1, { title: "Author A draft" })], error: null });
  await runDom(async (h) => {
    const { act, client, qc, root } = h;
    await act(async () => { root.render(renderReports(h)); });
    assert.match(text(draftRegion()), /Loading drafts/);
    assert.equal(requests.length, 0);
    await act(async () => { qc.bindBrowserQueryCacheToUser("user-a"); });
    assert.equal(requests.length, 0);
    await act(async () => { grant(qc, "user-a", "senior"); });
    await waitFor(act, () => text(draftRegion()).includes("Author A draft"));
    assert.ok(client.getQueryData(ownDraftKey("user-a")));

    let resolveLate;
    loadPage = () => new Promise((resolve) => { resolveLate = resolve; });
    await act(async () => { void client.invalidateQueries({ queryKey: ownDraftKey("user-a") }); });
    await waitFor(act, () => resolveLate !== undefined);
    const lateSignal = requests.at(-1).signal;
    loadPage = () => Promise.resolve({ data: [draftRow(2, { title: "Author B draft" })], error: null });
    await act(async () => { grant(qc, "user-b", "management"); });
    assert.equal(lateSignal.aborted, true);
    assert.doesNotMatch(text(draftRegion()), /Author A draft/);
    assert.equal(client.getQueryData(ownDraftKey("user-a")), undefined);
    await act(async () => {
      resolveLate({ data: [draftRow(3, { title: "Late draft from A" })], error: null });
    });
    await waitFor(act, () => text(draftRegion()).includes("Author B draft"));
    assert.doesNotMatch(text(draftRegion()), /Late draft from A/);
    assert.equal(client.getQueryData(ownDraftKey("user-a")), undefined);

    await act(async () => { qc.bindBrowserQueryCacheToUser(null); });
    assert.doesNotMatch(text(draftRegion()), /Author B draft/);
    assert.equal(client.getQueryData(ownDraftKey("user-b")), undefined);
    assert.equal(requests.length, 3);
  }, (request) => {
    requests.push(request);
    return loadPage();
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
