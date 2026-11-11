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

function createDatabase(readDraftPage, writeDraft, { readDetail, updateDraft }) {
  let readError = null;
  let shouldDefer = () => false;
  const waiting = [];
  const calls = [];
  function respond(table, speciesId, rows) {
    calls.push({ table, speciesId });
    const payload = () => (readError
      ? { data: null, error: readError }
      : { data: rows.map((row) => ({ ...row })), error: null });
    if (!shouldDefer(table)) return Promise.resolve(payload());
    return new Promise((resolve) => {
      waiting.push((override) => resolve(override ?? payload()));
    });
  }
  const client = {
    from(table) {
      if (table === "reports") {
        const request = { table, filters: [], orders: [] };
        const query = {
          insert(payload) {
            return {
              select(columns) {
                return {
                  single: () => ({
                    setHeader: (name, value) => writeDraft({
                      table, payload: { ...payload }, columns, headers: { [name]: value },
                    }),
                  }),
                };
              },
            };
          },
          update(payload) { request.payload = { ...payload }; return query; },
          select(columns) { request.columns = columns; return query; },
          eq(...filter) { request.filters.push(filter); return query; },
          order(column, { ascending }) { request.orders.push([column, ascending]); return query; },
          range(...range) { request.range = range; return query; },
          abortSignal(signal) {
            request.signal = signal;
            return request.range ? readDraftPage(request) : query;
          },
          maybeSingle() {
            return request.payload ? {
              setHeader: (name, value) => updateDraft({ ...request, headers: { [name]: value } }),
            } : readDetail(request);
          },
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
    deferReads(next, onlyTable) { shouldDefer = (table) => next && (!onlyTable || table === onlyTable); },
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

async function runDom(fn, readDraftPage, writeDraft, edits = {}) {
  const installed = installDom();
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { QueryClientProvider } = require("@tanstack/react-query");
  const database = createDatabase(readDraftPage, writeDraft, edits);
  const load = loadGraph(database);
  const qc = load("@/lib/queryClient");
  database.client.auth = {
    async getSession() {
      const { userId } = qc.getVerifiedAuthSnapshot();
      const session = userId ? { user: { id: userId }, access_token: `token-${userId}` } : null;
      return { data: { session }, error: null };
    },
  };
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

const ownDraftKey = (user) => ["auth-user", user, "reports", "own-drafts"];
const draftForm = () => document.querySelector("form");
const field = (name) => draftForm().elements.namedItem(name);
const readDrafts = (data = []) => Promise.resolve({ data, error: null });

function persistedDraft(payload, fields = {}) {
  return draftRow(4, {
    species_id: payload.species_id,
    specimen_id: payload.specimen_id,
    title: payload.title,
    report_type: payload.report_type,
    created_by: "00000000-0000-4000-8000-000000000080",
    review_status: "draft",
    record_status: "active",
    ...fields,
  });
}

async function mountReports(h, role = "employee") {
  await h.act(async () => {
    grant(h.qc, "user-a", role);
    h.root.render(renderReports(h));
  });
  await waitFor(h.act, () => document.getElementById("report-species") !== null);
}

async function saveDraft(act) {
  await act(async () => { buttonByText("Save draft").click(); });
}

test("Reports saves a full draft once and replaces a pending pre-INSERT read with fresh data", async () => {
  const reads = [];
  const writes = [];
  await runDom(async (h) => {
    await mountReports(h);
    await choose(h.act, LYNX, ASH);
    field("report_type").value = "medical";
    field("title").value = "  Check Ash  ";
    field("body").value = "First line\nSecond line  ";
    assert.match(text(draftRegion()), /Loading drafts/);
    assert.equal(reads.length, 1);

    await h.act(async () => {
      buttonByText("Save draft").click();
      buttonByText("Save draft").click();
    });
    await waitFor(h.act, () => writes.length > 0 && buttonByText("Save draft").disabled);
    assert.match(text(draftForm()), /Saving draft/);
    assert.equal(writes.length, 1);
    const { request, resolve } = writes[0];
    assert.equal(request.table, "reports");
    assert.deepEqual(request.headers, { Authorization: "Bearer token-user-a" });
    assert.deepEqual(request.payload, {
      species_id: LYNX,
      specimen_id: ASH,
      report_type: "medical",
      title: "  Check Ash  ",
      body: "First line\nSecond line  ",
    });
    assert.equal(request.columns, "id, title, report_type, species_id, updated_at, specimen_id, created_by, review_status, record_status");
    const created = persistedDraft(request.payload);
    await h.act(async () => { resolve({ data: created, error: null }); });
    await waitFor(h.act, () => text(draftForm()).includes("Draft saved."));
    assert.equal(reads.length, 2);
    assert.equal(reads[0].signal.aborted, true);
    assert.match(text(draftRegion()), /Check Ash/);
    assert.equal(field("title").value, "");
    assert.equal(document.getElementById("report-species").value, "");

    await h.act(async () => { reads[0].resolve({ data: [], error: null }); });
    assert.match(text(draftRegion()), /Check Ash/);

    const fresh = draftRow(1, { title: "Another draft from fresh read", updated_at: "2026-03-15T14:30:45.123457Z" });
    await h.act(async () => { reads[1].resolve({ data: [fresh, created], error: null }); });
    await waitFor(h.act, () => draftRegion().querySelectorAll("li").length === 2);
    assert.match(text(draftRegion().querySelector("li")), /Another draft from fresh read/);
    assert.match(text(draftRegion()), /Check Ash/);
    assert.equal(writes.length, 1);
  }, ({ signal }) => new Promise((resolve) => reads.push({ signal, resolve })),
  (request) => new Promise((resolve) => writes.push({ request, resolve })));
});

test("Reports keeps 1,001 unique drafts when an INSERT shifts the page boundary and refresh fails", async () => {
  const originalRows = Array.from({ length: 1000 }, (_, index) => draftRow(index + 1));
  const reads = [];
  let readSecondPage;
  let finishWrite;
  let created;
  await runDom(async (h) => {
    const key = ownDraftKey("user-a");
    await mountReports(h);
    await waitFor(h.act, () => readSecondPage !== undefined);
    await choose(h.act, LYNX);
    field("title").value = "Saved between pages";
    await saveDraft(h.act);
    await waitFor(h.act, () => created !== undefined);

    await h.act(async () => { readSecondPage(); });
    await waitFor(h.act, () => h.client.getQueryState(key)?.status === "success");
    const beforeResponse = h.client.getQueryData(key);
    assert.equal(beforeResponse.some(({ id }) => id === created.id), false);
    assert.match(text(draftForm()), /Saving draft/);

    await h.act(async () => { finishWrite({ data: created, error: null }); });
    await waitFor(h.act, () => buttonByText("Retry draft list") !== null);
    assert.deepEqual(reads.slice(0, 3), [[0, 999], [1000, 1999], [0, 999]]);
    const cached = h.client.getQueryData(key);
    const ids = [...cached].map(({ id }) => id);
    assert.equal(ids.length, 1001);
    assert.equal(new Set(ids).size, 1001);
    assert.deepEqual(ids, [created.id, ...originalRows.map(({ id }) => id)]);
    assert.match(text(draftRegion()), /Saved between pages/);
    assert.equal(draftRegion().querySelectorAll("li").length, 1001);
    assert.equal(beforeResponse.length, 1000);
    assert.equal(new Set(beforeResponse.map(({ id }) => id)).size, 1000);
  }, ({ range }) => {
    reads.push(range);
    if (reads.length === 1) return readDrafts(originalRows);
    if (reads.length === 2) {
      return new Promise((resolve) => {
        // The second page is read after the INSERT commits, while its response is still pending.
        readSecondPage = () => {
          const page = [created, ...originalRows].slice(range[0], range[1] + 1);
          assert.deepEqual(page, [originalRows.at(-1)]);
          resolve({ data: page, error: null });
        };
      });
    }
    return Promise.resolve({ data: null, error: READ_FAILURE });
  }, ({ payload }) => new Promise((resolve) => {
    created = persistedDraft(payload, { id: draftRow(1001).id, updated_at: "2026-11-10T12:00:00Z" });
    finishWrite = resolve;
  }));
});

test("Reports deduplicates the cache on save and prefers the confirmed INSERT row", async () => {
  const existing = draftRow(1);
  const staleCopy = draftRow(4, { title: "Stale cached copy" });
  let saved = false;
  await runDom(async (h) => {
    const key = ownDraftKey("user-a");
    await mountReports(h);
    await waitFor(h.act, () => h.client.getQueryState(key)?.status === "success");
    await choose(h.act, LYNX);
    field("title").value = "Confirmed draft";
    await h.act(async () => {
      h.client.setQueryData(key, [existing, { ...existing }, staleCopy]);
      buttonByText("Save draft").click();
    });
    await waitFor(h.act, () => buttonByText("Retry draft list") !== null);
    assert.deepEqual(Array.from(h.client.getQueryData(key), (row) => ({ ...row })), [
      existing, { ...staleCopy, title: "Confirmed draft", report_type: null },
    ]);
  }, () => saved ? Promise.resolve({ data: null, error: READ_FAILURE }) : readDrafts([existing]), ({ payload }) => {
    saved = true;
    return Promise.resolve({ data: persistedDraft(payload), error: null });
  });
});

test("Reports clears the old specimen on species change and saves nullable fields", async () => {
  const writes = [];
  let finishRefresh;
  const later = draftRow(2, { updated_at: "2026-03-15T14:30:45.123457Z" });
  const tied = draftRow(3, { updated_at: "2026-03-15T15:30:45.123456+01:00" });
  await runDom(async (h) => {
    await mountReports(h, "senior");
    await waitFor(h.act, () => draftRegion().querySelectorAll("li").length === 2);
    await choose(h.act, LYNX, ASH);
    await choose(h.act, FERN);
    assert.equal(document.getElementById("report-specimen").value, "");
    field("title").value = "   ";
    field("body").value = "";
    await saveDraft(h.act);
    await waitFor(h.act, () => text(draftForm()).includes("Draft saved."));
    assert.deepEqual(writes, [{
      species_id: FERN, specimen_id: null, report_type: null, title: null, body: null,
    }]);
    await waitFor(h.act, () => draftRegion().querySelectorAll("li").length === 3);
    const titles = [...draftRegion().querySelectorAll("li p:first-child")].map(text);
    assert.deepEqual(titles, ["Draft 2", "Draft 3", "Untitled draft"]);
    await h.act(async () => {
      finishRefresh({ data: [later, tied, persistedDraft(writes[0])], error: null });
    });
  }, () => writes.length
    ? new Promise((resolve) => { finishRefresh = resolve; })
    : readDrafts([later, tied]), ({ payload }) => {
    writes.push(payload);
    return Promise.resolve({ data: persistedDraft(payload), error: null });
  });
});

test("Report draft text treats only empty and ordinary-space-only strings as null", async () => {
  await runDom(async ({ load }) => {
    const { newReportDraftSchema } = load("./createReportDraft.ts");
    const cases = [
      ["", null],
      ["   ", null],
      ["\t", "\t"],
      ["\n", "\n"],
      ["\u00a0", "\u00a0"],
      ["  \n", "  \n"],
      [" \tDraft text\u00a0 ", " \tDraft text\u00a0 "],
    ];
    for (const [value, expected] of cases) {
      const { title, body } = newReportDraftSchema.parse({
        species_id: LYNX, specimen_id: null, report_type: null, title: value, body: value,
      });
      assert.equal(title, expected, `title for ${JSON.stringify(value)}`);
      assert.equal(body, expected, `body for ${JSON.stringify(value)}`);
    }
  });
});

test("Reports rejects missing or unavailable species and incompatible specimens before INSERT", async () => {
  const writes = [];
  await runDom(async (h) => {
    await mountReports(h);
    await saveDraft(h.act);
    assert.match(text(draftForm()), /Choose a valid species/);

    await choose(h.act, LYNX, ASH);
    const specimenKey = ["auth-user", "user-a", "specimens", "by-species", LYNX];
    await h.act(async () => {
      // The list changes before React has reconciled the selected specimen.
      h.client.setQueryData(specimenKey, [SPECIMEN_ROWS.find((row) => row.id === MOSS)]);
      buttonByText("Save draft").click();
    });
    await waitFor(h.act, () => text(draftForm()).includes("Could not save draft."));

    await choose(h.act, FERN);
    await h.act(async () => {
      h.client.setQueryData(["auth-user", "user-a", "species-database", "list"], []);
      buttonByText("Save draft").click();
    });
    await waitFor(h.act, () => text(draftForm()).includes("Could not save draft."));
    assert.equal(writes.length, 0);
    assert.doesNotMatch(text(draftForm()), /Draft saved/);
  }, () => readDrafts(), (request) => {
    writes.push(request);
    return Promise.resolve({ data: persistedDraft(request.payload), error: null });
  });
});

test("Reports retains inputs and creates no phantom draft on FK rejection or unconfirmed INSERT", async () => {
  const writes = [];
  const responses = [
    () => ({ data: null, error: { code: "23503", message: "private composite FK error" } }),
    () => ({ data: null, error: null }),
    (payload) => ({ data: persistedDraft(payload, { record_status: "archived" }), error: null }),
  ];
  await runDom(async (h) => {
    h.client.setDefaultOptions({ ...h.client.getDefaultOptions(), mutations: { retry: 2, retryDelay: 0 } });
    await mountReports(h, "management");
    await choose(h.act, LYNX, ASH);
    field("title").value = "Keep my text";
    for (let count = 1; count <= responses.length; count++) {
      await saveDraft(h.act);
      await waitFor(h.act, () => writes.length >= count && text(draftForm()).includes("Could not save draft."));
      assert.equal(writes.length, count);
      assert.equal(field("title").value, "Keep my text");
      assert.doesNotMatch(text(draftForm()), /Draft saved|private composite FK error/);
      assert.equal(draftRegion().querySelectorAll("li").length, 0);
      assert.equal(h.client.getQueryData(ownDraftKey("user-a")).length, 0);
    }
  }, () => readDrafts(), ({ payload }) => {
    const response = responses[writes.length];
    writes.push(payload);
    return Promise.resolve(response(payload));
  });
});

for (const nextUser of [null, "user-b"]) {
  test(`Reports discards the prior form and pending save result on ${nextUser ? "account switch" : "logout"}`, async () => {
    let finishWrite;
    let rows = [];
    const writes = [];
    await runDom(async (h) => {
      await mountReports(h);
      await choose(h.act, LYNX);
      field("title").value = "Author A private draft";
      await saveDraft(h.act);
      await waitFor(h.act, () => finishWrite !== undefined);

      rows = [draftRow(5, { title: "Author B draft" })];
      await h.act(async () => {
        if (nextUser) grant(h.qc, nextUser);
        else h.qc.bindBrowserQueryCacheToUser(null);
      });
      if (nextUser) {
        await waitFor(h.act, () => text(draftRegion()).includes("Author B draft"));
        assert.equal(field("title").value, "");
        assert.equal(document.getElementById("report-species").value, "");
      } else {
        assert.equal(draftForm(), null);
      }

      // The original request can commit even though its UI session has ended.
      await h.act(async () => { finishWrite({ data: persistedDraft(writes[0]), error: null }); });
      assert.equal(writes.length, 1);
      assert.doesNotMatch(text(document.body), /Author A private draft|Draft saved|Could not save draft/);
      assert.equal(h.client.getQueryData(ownDraftKey("user-a")), undefined);
      if (nextUser) assert.deepEqual([...h.client.getQueryData(ownDraftKey(nextUser))], rows);
    }, () => readDrafts(rows), ({ payload }) => new Promise((resolve) => {
      writes.push(payload);
      finishWrite = resolve;
    }));
  });
}

test("Reports stops before INSERT when the account switches during session token lookup", async () => {
  let finishSession;
  const writes = [];
  await runDom(async (h) => {
    await mountReports(h);
    await choose(h.act, LYNX);
    field("title").value = "Author A private draft";
    h.database.client.auth.getSession = () => new Promise((resolve) => { finishSession = resolve; });
    await saveDraft(h.act);
    await waitFor(h.act, () => finishSession !== undefined);
    await h.act(async () => { grant(h.qc, "user-b"); });
    await h.act(async () => {
      finishSession({ data: { session: { user: { id: "user-b" }, access_token: "token-user-b" } }, error: null });
    });
    assert.equal(writes.length, 0);
    assert.equal(field("title").value, "");
    assert.doesNotMatch(text(document.body), /Author A private draft|Draft saved|Could not save draft/);
  }, () => readDrafts(), (request) => { writes.push(request); });
});

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

const detailKey = (user, id) => ["auth-user", user, "reports", "draft-detail", id];
const editFilters = (id) => [["id", id], ["review_status", "draft"], ["record_status", "active"]];
const editColumns = "id, title, report_type, species_id, updated_at, specimen_id, body, review_status, record_status";

function detailRow(index, fields = {}) {
  return draftRow(index, { specimen_id: null, body: null, review_status: "draft", record_status: "active", ...fields });
}

async function openDraft({ act }, label, expectForm = true) {
  await waitFor(act, () => buttonByText(label) !== null);
  await act(async () => { buttonByText(label).click(); });
  if (expectForm) await waitFor(act, () => buttonByText("Save changes") !== null);
}

test("Reports requires a successful fresh read after rapidly reopening a cached draft", async () => {
  const { flushSync } = require("react-dom");
  let a = detailRow(1, { title: "Draft A", body: "Obsolete A body" });
  const b = detailRow(2, { title: "Draft B", body: "Private B body" });
  const key = detailKey("user-a", a.id);
  const reads = [];
  const writes = [];
  let defer = false;

  await runDom(async (h) => {
    h.client.setQueryDefaults(key, { staleTime: 60_000 });
    await mountReports(h);
    await openDraft(h, a.title);
    await waitFor(h.act, () => !buttonByText("Save changes").disabled);
    assert.equal(field("body").value, "Obsolete A body");

    a = { ...a, body: "New server body for A" };
    defer = true;
    await h.act(async () => {
      // Commit both selections before the zero-delay cache GC can run.
      flushSync(() => { buttonByText(b.title).click(); });
      assert.equal(buttonByText(b.title).getAttribute("aria-current"), "true");
      assert.equal(h.client.getQueryData(key).body, "Obsolete A body");
      flushSync(() => { buttonByText(a.title).click(); });
    });
    await waitFor(h.act, () => reads.length === 2);
    assert.deepEqual(reads.map(({ id }) => id), [b.id, a.id]);
    assert.equal(reads[0].signal.aborted, true);
    assert.equal(h.client.getQueryData(key).body, "Obsolete A body");
    const cachedQuery = h.client.getQueryCache().find({ queryKey: key });
    assert.equal(cachedQuery.options.staleTime, 60_000);
    assert.equal(cachedQuery.isStaleByTime(60_000), false);
    assert.match(text(document.body), /Loading draft…/);
    assert.equal(draftForm(), null);
    assert.equal(buttonByText("Save changes"), null);

    await h.act(async () => {
      reads[0].resolve({ data: b, error: null });
      reads[1].resolve({ data: null, error: READ_FAILURE });
    });
    await waitFor(h.act, () => buttonByText("Retry draft") !== null);
    assert.equal(h.client.getQueryData(key).body, "Obsolete A body");
    assert.equal(draftForm(), null);
    assert.equal(buttonByText("Save changes"), null);

    await h.act(async () => { buttonByText("Retry draft").click(); });
    await waitFor(h.act, () => reads.length === 3);
    assert.equal(draftForm(), null);
    await h.act(async () => { reads[2].resolve({ data: a, error: null }); });
    await waitFor(h.act, () => buttonByText("Save changes")?.disabled === false);
    assert.equal(field("body").value, "New server body for A");

    const editor = draftForm();
    field("title").value = "Only the title changed";
    await h.act(async () => { void h.client.invalidateQueries({ queryKey: key }); });
    await waitFor(h.act, () => reads.length === 4);
    await h.act(async () => {
      reads[3].resolve({ data: { ...a, updated_at: "2026-03-15T14:31:00Z" }, error: null });
    });
    await waitFor(h.act, () => h.client.getQueryState(key).fetchStatus === "idle");
    assert.equal(draftForm(), editor);
    assert.equal(field("title").value, "Only the title changed");
    assert.equal(field("body").value, "New server body for A");

    await h.act(async () => { buttonByText("Save changes").click(); });
    await waitFor(h.act, () => text(draftForm()).includes("Changes saved."));
    assert.equal(writes.length, 1);
    assert.equal(writes[0].title, "Only the title changed");
    assert.equal(writes[0].body, "New server body for A");

    await waitFor(h.act, () => reads.length === 5);
    await h.act(async () => { grant(h.qc, "user-b"); });
    assert.equal(reads[4].signal.aborted, true);
    await h.act(async () => { reads[4].resolve({ data: a, error: null }); });
    assert.equal(field("body").value, "");
    assert.equal(buttonByText("Save changes"), null);
    assert.equal(h.client.getQueryData(key), undefined);
    assert.equal(h.client.getQueryData(detailKey("user-b", a.id)), undefined);
  }, () => readDrafts([a, b]), undefined, {
    readDetail({ filters, signal }) {
      const id = filters[0][1];
      return defer ? new Promise((resolve) => reads.push({ id, signal, resolve })) : readDrafts(a);
    },
    updateDraft({ payload }) {
      writes.push(payload);
      a = { ...a, ...payload };
      return readDrafts(a);
    },
  });
});

test("My drafts labels a whitespace-only title without changing the stored or normal titles", async () => {
  const blank = detailRow(1, { title: "\t\n" });
  const normal = draftRow(2, { title: "  Visible title  " });
  await runDom(async (h) => {
    await mountReports(h);
    await waitFor(h.act, () => draftRegion().querySelectorAll("button").length === 2);
    assert.ok(buttonByText("Untitled draft"));
    assert.ok(buttonByText(normal.title));
    assert.equal(h.client.getQueryData(ownDraftKey("user-a"))[0].title, blank.title);
    await openDraft(h, "Untitled draft");
    assert.equal(field("title").value, blank.title);
  }, () => readDrafts([blank, normal]), undefined, { readDetail: () => readDrafts(blank) });
});

test("Reports loads, saves and synchronises a full edit while cancelling pre-save reads", async () => {
  const original = detailRow(2, { specimen_id: ASH, title: "Ash's draft", body: "First\r\nSecond\r" });
  const other = draftRow(1);
  const newTime = "2026-03-15T14:30:45.123457Z";
  const reads = { list: [], detail: [] };
  const writes = [];
  let defer = false;
  function read(kind, request, data) {
    assert.ok(request.signal instanceof AbortSignal);
    return defer ? new Promise((resolve) => reads[kind].push({ ...request, resolve })) : readDrafts(data);
  }

  await runDom(async (h) => {
    await mountReports(h);
    await openDraft(h, original.title);
    await waitFor(h.act, () => !buttonByText("Save changes").disabled);
    assert.equal(document.getElementById("report-species").value, LYNX);
    assert.equal(document.getElementById("report-specimen").value, ASH);
    assert.equal(field("report_type").value, "care");
    assert.equal(field("title").value, original.title);
    assert.equal(field("body").value, "First\nSecond\n");
    assert.equal(document.querySelectorAll("form").length, 1);

    field("title").value = "  Ash updated  ";
    defer = true;
    await h.act(async () => { void h.client.invalidateQueries({ queryKey: detailKey("user-a", original.id) }); });
    await waitFor(h.act, () => reads.detail.length === 1);
    await h.act(async () => {
      reads.detail.shift().resolve({ data: { ...original, body: "Earlier background snapshot" }, error: null });
    });
    assert.equal(field("title").value, "  Ash updated  ");
    assert.equal(field("body").value, "First\nSecond\n");

    await h.act(async () => {
      void h.client.invalidateQueries({ queryKey: ownDraftKey("user-a") });
      void h.client.invalidateQueries({ queryKey: detailKey("user-a", original.id) });
    });
    await waitFor(h.act, () => reads.detail.length === 1 && reads.list.length === 1);
    field("report_type").value = "medical";
    await h.act(async () => {
      buttonByText("Save changes").click();
      buttonByText("Save changes").click();
      buttonByText(other.title).click();
      buttonByText("Back to new draft").click();
    });
    await waitFor(h.act, () => writes.length === 1 && buttonByText("Back to new draft").disabled);
    assert.match(text(draftForm()), /Saving changes/);
    const [{ request, resolve }] = writes;
    assert.equal(request.table, "reports");
    assert.equal(request.columns, editColumns);
    assert.deepEqual(request.filters, editFilters(original.id));
    assert.deepEqual(request.headers, { Authorization: "Bearer token-user-a" });
    assert.deepEqual(request.payload, {
      species_id: LYNX, specimen_id: ASH, report_type: "medical", title: "  Ash updated  ", body: original.body,
    });

    const saved = { ...original, ...request.payload, updated_at: newTime };
    await h.act(async () => { resolve({ data: saved, error: null }); });
    await waitFor(h.act, () => text(draftForm()).includes("Changes saved."));
    for (const [kind, stale] of [["list", [other, original]], ["detail", original]]) {
      assert.equal(reads[kind].length, 2);
      assert.equal(reads[kind][0].signal.aborted, true);
      await h.act(async () => { reads[kind][0].resolve({ data: stale, error: null }); });
    }
    const first = draftRegion().querySelector("li");
    assert.match(text(first), /Ash updated.*medical/s);
    assert.equal(first.querySelector("time").dateTime, newTime);
    assert.equal(field("title").value, saved.title);
    assert.equal(field("report_type").value, "medical");
    assert.equal(h.client.getQueryData(detailKey("user-a", original.id)).title, saved.title);
    await h.act(async () => {
      reads.list[1].resolve({ data: [other, saved], error: null });
      reads.detail[1].resolve({ data: saved, error: null });
      buttonByText("Back to new draft").click();
    });
    assert.equal(field("title").value, "");
    assert.equal(writes.length, 1);
  }, (request) => read("list", request, [other, original]), undefined, {
    readDetail(request) {
      assert.deepEqual(request.filters, editFilters(original.id));
      assert.equal(request.columns, editColumns);
      return read("detail", request, original);
    },
    updateDraft: (request) => new Promise((resolve) => writes.push({ request, resolve })),
  });
});

test("Reports ignores a late detail after switching and distinguishes retryable failures and missing drafts", async () => {
  const a = detailRow(1, { title: "First draft", body: "Private first body" });
  const b = detailRow(2, { title: null, report_type: null });
  const reads = [];
  await runDom(async (h) => {
    await mountReports(h);
    await openDraft(h, a.title, false);
    await waitFor(h.act, () => reads.length === 1);
    assert.match(text(document.body), /Loading draft…/);
    assert.equal(draftForm(), null);
    await openDraft(h, "Untitled draft", false);
    await waitFor(h.act, () => reads.length === 2);
    assert.equal(reads[0].signal.aborted, true);
    await h.act(async () => {
      reads[0].resolve({ data: a, error: null });
      reads[1].resolve({ data: null, error: READ_FAILURE });
    });
    await waitFor(h.act, () => buttonByText("Retry draft") !== null);
    assert.match(text(document.body), /Could not load draft.*Unable to complete the database operation/);
    assert.doesNotMatch(text(document.body), /secret|Private first body|no longer available/);
    assert.equal(draftForm(), null);
    assert.equal(h.client.getQueryData(detailKey("user-a", a.id)), undefined);

    await h.act(async () => { buttonByText("Retry draft").click(); });
    await waitFor(h.act, () => reads.length === 3);
    await h.act(async () => { reads[2].resolve({ data: a, error: null }); });
    await waitFor(h.act, () => buttonByText("Retry draft") !== null);
    assert.equal(draftForm(), null, "a mismatched response ID cannot open the editor");
    await h.act(async () => { buttonByText("Retry draft").click(); });
    await waitFor(h.act, () => reads.length === 4);
    await h.act(async () => { reads[3].resolve({ data: null, error: null }); });
    await waitFor(h.act, () => text(document.body).includes("This draft is no longer available."));
    assert.equal(draftForm(), null);
    assert.equal(buttonByText("Retry draft"), null);

    await h.act(async () => { buttonByText("Back to new draft").click(); });
    assert.ok(buttonByText("Save draft"));
  }, () => readDrafts([a, b]), undefined, {
    readDetail: (request) => new Promise((resolve) => reads.push({ ...request, resolve })),
  });
});

test("Reports preserves a linked specimen during a failed load and requires deliberate resolution", async () => {
  const original = detailRow(1, { specimen_id: ASH });
  let updated;
  await runDom(async (h) => {
    await mountReports(h);
    h.database.deferReads(true, "specimens");
    await openDraft(h, original.title);
    await waitFor(h.act, () => h.database.waiting.length === 1);
    assert.equal(document.getElementById("report-specimen").value, ASH);
    assert.equal(buttonByText("Save changes").disabled, true);
    assert.match(text(draftForm()), /Loading specimens/);
    h.database.deferReads(false);
    h.database.failReads(READ_FAILURE);
    await h.act(async () => { h.database.releaseNext({ data: null, error: READ_FAILURE }); });
    await waitFor(h.act, () => buttonByText("Retry specimen list") !== null);
    assert.equal(document.getElementById("report-specimen").value, ASH);
    assert.equal(buttonByText("Save changes").disabled, true);

    // A successful but stale or empty list must not turn the stored link into NULL.
    h.database.failReads(null);
    h.database.deferReads(true, "specimens");
    await h.act(async () => { buttonByText("Retry specimen list").click(); });
    await waitFor(h.act, () => h.database.waiting.length === 1);
    await h.act(async () => { h.database.releaseNext({ data: [], error: null }); });
    await waitFor(h.act, () => buttonByText("Retry specimen list")?.disabled === false);
    assert.equal(document.getElementById("report-specimen").value, ASH);
    assert.equal(buttonByText("Save changes").disabled, true);
    assert.match(text(draftForm()), /selected specimen could not be verified/);
    assert.equal(updated, undefined);

    h.database.deferReads(false);
    await h.act(async () => { buttonByText("Retry specimen list").click(); });
    await waitFor(h.act, () => !buttonByText("Save changes").disabled);
    assert.equal(document.getElementById("report-specimen").value, ASH);
    await choose(h.act, FERN);
    assert.equal(document.getElementById("report-specimen").value, "");
    await waitFor(h.act, () => !buttonByText("Save changes").disabled);
    await h.act(async () => { buttonByText("Save changes").click(); });
    await waitFor(h.act, () => text(draftForm()).includes("Changes saved."));
    assert.equal(updated.species_id, FERN);
    assert.equal(updated.specimen_id, null);
  }, () => readDrafts([updated ?? original]), undefined, {
    readDetail: () => readDrafts(updated ?? original),
    updateDraft({ payload }) {
      updated = { ...original, ...payload };
      return readDrafts(updated);
    },
  });
});

test("Reports keeps nullable edit fields and unsaved text through unconfirmed UPDATEs", async () => {
  const original = detailRow(1, { title: null, report_type: null });
  const writes = [];
  const failures = [
    [() => ({ data: null, error: null }), /no longer available/],
    [() => ({ data: null, error: { code: "42501", message: "private policy" } }), /no longer available/],
    [() => ({ data: null, error: READ_FAILURE }), /Unable to complete the database operation/],
    [() => ({ data: null, error: { code: "23503", message: "private FK error" } }), /provided input is invalid/],
    [(row) => ({ data: { ...row, review_status: "submitted" }, error: null }), /database operation/],
    [(row) => ({ data: { ...row, body: "Wrong returned text" }, error: null }), /database operation/],
    [(row) => ({ data: { ...row, id: detailRow(8).id }, error: null }), /database operation/],
    [(row) => ({ data: { ...row, updated_at: "invalid" }, error: null }), /database operation/],
  ];
  let saved;
  let finishFailedWrite;
  await runDom(async (h) => {
    await mountReports(h, "senior");
    await openDraft(h, "Untitled draft");
    assert.equal(field("title").value, "");
    assert.equal(field("body").value, "");
    assert.equal(field("report_type").value, "");
    assert.equal(document.getElementById("report-specimen").value, "");
    await waitFor(h.act, () => !buttonByText("Save changes").disabled);
    field("title").value = "   ";
    field("body").value = "\t\n";

    for (const [index, [, message]] of failures.entries()) {
      await h.act(async () => { buttonByText("Save changes").click(); });
      await waitFor(h.act, () => writes.length === index + 1 && buttonByText("Save changes").disabled);
      await h.act(async () => { finishFailedWrite(); });
      await waitFor(h.act, () => text(draftForm()).includes("Could not save changes"));
      assert.match(text(draftForm()), /Could not save changes/);
      assert.match(text(draftForm()), message);
      assert.doesNotMatch(text(draftForm()), /Changes saved|private|secret/);
      assert.equal(field("body").value, "\t\n");
      assert.equal(field("title").value, "   ");
      assert.equal(h.client.getQueryData(detailKey("user-a", original.id)).body, null);
    }

    field("body").value = "";
    await h.act(async () => { buttonByText("Save changes").click(); });
    await waitFor(h.act, () => text(draftForm()).includes("Changes saved."));
    const nullable = { species_id: LYNX, specimen_id: null, report_type: null, title: null, body: null };
    assert.deepEqual(writes, [...failures.map(() => ({ ...nullable, body: "\t\n" })), nullable]);
  }, () => readDrafts([saved ?? original]), undefined, {
    readDetail: () => readDrafts(saved ?? original),
    updateDraft({ payload }) {
      const failure = failures[writes.length];
      writes.push(payload);
      const row = { ...original, ...payload };
      if (failure) return new Promise((resolve) => { finishFailedWrite = () => resolve(failure[0](row)); });
      saved = row;
      return readDrafts(saved);
    },
  });
});

test("Mocked report policies deny other authors' drafts across all roles and edit filters exclude later states", async () => {
  const foreign = detailRow(1, { author: "user-b" });
  const submitted = detailRow(2, { author: "user-a", review_status: "submitted" });
  const reviewed = detailRow(3, { author: "user-a", review_status: "reviewed" });
  const own = detailRow(4, { author: "user-a" });
  const rows = [foreign, submitted, reviewed, own];
  let access;
  function visible(request) {
    // Simulated RLS. Other policies can expose submitted/reviewed rows for reads.
    return rows.find((row) => request.filters.every(([key, value]) => row[key] === value)
      && (row.review_status !== "draft" || row.author === access.userId)) ?? null;
  }
  await runDom(async ({ qc, load, database }) => {
    const { fetchReportDraftDetail, updateReportDraft } = load("./editReportDraft.ts");
    const context = { userId: "user-a" };
    const input = { species_id: LYNX, specimen_id: null, report_type: null, title: null, body: null };
    for (const role of ["employee", "senior", "management"]) {
      grant(qc, context.userId, role);
      access = qc.getVerifiedAuthSnapshot();
      assert.equal(access.role, role);
      for (const blocked of [foreign, submitted, reviewed]) {
        assert.equal(await fetchReportDraftDetail(database.client, blocked.id, new AbortController().signal), null);
        await assert.rejects(updateReportDraft(database.client, blocked.id, input, context), { code: "not_found" });
      }
      assert.equal((await fetchReportDraftDetail(database.client, own.id, new AbortController().signal)).id, own.id);
      assert.equal((await updateReportDraft(database.client, own.id, input, context)).id, own.id);
    }
  }, undefined, undefined, {
    readDetail: (request) => readDrafts(visible(request)),
    updateDraft(request) {
      const row = visible(request);
      return readDrafts(row ? { ...row, ...request.payload } : null);
    },
  });
});

for (const transition of ["logout", "account switch", "permission change"]) {
  test(`Reports discards pending edit reads, writes and input on ${transition}`, async () => {
    const original = detailRow(1, { body: "Private author body" });
    const reads = [];
    let finishWrite;
    let defer = false;
    let list = [original];
    await runDom(async (h) => {
      await mountReports(h);
      await openDraft(h, original.title);
      await waitFor(h.act, () => !buttonByText("Save changes").disabled);
      field("body").value = "Pending private edit";
      defer = true;
      await h.act(async () => {
        void h.client.invalidateQueries({ queryKey: detailKey("user-a", original.id) });
        buttonByText("Save changes").click();
      });
      await waitFor(h.act, () => finishWrite !== undefined && reads.length === 1);
      list = [];
      await h.act(async () => {
        if (transition === "logout") h.qc.bindBrowserQueryCacheToUser(null);
        else if (transition === "account switch") grant(h.qc, "user-b");
        else grant(h.qc, "user-a", "management");
      });
      assert.equal(buttonByText("Save changes"), null);
      assert.equal(reads[0].signal.aborted, true);
      assert.doesNotMatch(text(document.body), /Private author body|Pending private edit/);
      if (transition === "logout") assert.equal(draftForm(), null);
      else assert.equal(field("body").value, "");

      await h.act(async () => {
        reads[0].resolve({ data: original, error: null });
        finishWrite();
      });
      assert.doesNotMatch(text(document.body), /Private author body|Pending private edit|Changes saved/);
      assert.equal(h.client.getQueryData(detailKey("user-a", original.id)), undefined);
      assert.equal(h.client.getQueryData(detailKey("user-b", original.id)), undefined);
      if (transition !== "logout") {
        const user = transition === "account switch" ? "user-b" : "user-a";
        await waitFor(h.act, () => text(draftRegion()).includes("No drafts yet."));
        assert.equal(h.client.getQueryData(ownDraftKey(user)).length, 0);
      }
    }, () => readDrafts(list), undefined, {
      readDetail: ({ signal }) => defer
        ? new Promise((resolve) => reads.push({ signal, resolve }))
        : readDrafts(original),
      updateDraft: ({ payload }) => new Promise((resolve) => {
        finishWrite = () => resolve({ data: { ...original, ...payload }, error: null });
      }),
    });
  });
}

test("Reports prevents UPDATE if the access epoch changes during token lookup for the same user", async () => {
  const original = detailRow(1);
  let finishSession;
  let updates = 0;
  await runDom(async (h) => {
    await mountReports(h);
    await openDraft(h, original.title);
    await waitFor(h.act, () => !buttonByText("Save changes").disabled);
    h.database.client.auth.getSession = () => new Promise((resolve) => { finishSession = resolve; });
    await h.act(async () => { buttonByText("Save changes").click(); });
    await waitFor(h.act, () => finishSession !== undefined);
    await h.act(async () => {
      grant(h.qc, "user-a", "management");
      finishSession({ data: { session: { user: { id: "user-a" }, access_token: "old-token" } }, error: null });
    });
    assert.equal(updates, 0);
    assert.equal(buttonByText("Save changes"), null);
    assert.equal(field("title").value, "");
  }, () => readDrafts([original]), undefined, {
    readDetail: () => readDrafts(original),
    updateDraft: () => { updates++; return readDrafts(); },
  });
});
