/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS DOM harness. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../..");

function installDom() {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "http://localhost",
  });
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
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }
  return {
    dom,
    restore() {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      dom.window.close();
    },
  };
}

function loadGraph(sandboxFetch, speciesRows, supabase) {
  const modules = new Map();
  const listQuery = () => {
    const query = {
      select() { return query; },
      order() { return query; },
      range() { return query; },
      abortSignal() { return Promise.resolve({ data: speciesRows, error: null }); },
    };
    return query;
  };
  function load(request, parent = path.join(root, "src/components/programs/entry.ts")) {
    if (request === "react" || request === "react/jsx-runtime" || request === "react-dom/client") {
      return require(request);
    }
    if (request === "@tanstack/react-query") return require(request);
    if (request === "@/lib/supabase") {
      return { getSupabaseBrowserClient: () => supabase ?? { from: () => listQuery() } };
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
      `(function(require,module,exports,fetch){${compiled}\n})`,
      { window, document, console, queueMicrotask, fetch: sandboxFetch },
      { filename: file },
    );
    execute((dependency) => load(dependency, file), loaded, loaded.exports, sandboxFetch);
    return loaded.exports;
  }
  return load;
}

function text(node) {
  return node.textContent ?? "";
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buttonByText(label) {
  return [...document.querySelectorAll("button")].find((node) => text(node) === label) ?? null;
}

function localSpecies(id, displayName) {
  return {
    id,
    display_name: displayName,
    general_description: "A local record.",
    diet_preferences: "Plants",
    habitat_preferences: "Forest",
    handling_guidance: "Keep clear.",
    minimum_handlers: 2,
    safety_class: "low",
  };
}

function grant(qc, userId, role, displayName) {
  qc.bindBrowserQueryCacheToUser(userId);
  qc.applyBrowserPermissionRead(userId, {
    status: "active",
    role,
    displayName,
  });
}

async function waitFor(act, predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out\n${text(document.body).slice(0, 500)}`);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function setInput(act, input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

function renderApp(React, QueryClientProvider, client, app) {
  return React.createElement(
    QueryClientProvider,
    { client },
    React.createElement(app.SpeciesDatabaseApp),
  );
}

async function openProposalTab(act) {
  const tab = [...document.querySelectorAll("[role='tab']")]
    .find((node) => text(node) === "New Species Proposal");
  assert.ok(tab, `management tab missing: ${text(document.body).slice(0, 240)}`);
  await act(async () => {
    tab.click();
  });
  await waitFor(
    act,
    () => text(document.body).includes("Which dinosaur would you like to add?"),
  );
}

async function startSearch(act, calls, value) {
  const input = document.querySelector("input[name='species-name']");
  assert.ok(input, text(document.body).slice(0, 240));
  await setInput(act, input, value);
  const before = calls.length;
  await act(async () => {
    input.form.requestSubmit();
  });
  await waitFor(act, () => calls.length === before + 1);
  await waitFor(act, () => text(document.body).includes("Searching the species index"));
}

async function finishSearch(act, fetches, body, status = 200) {
  const resolve = fetches.shift();
  assert.equal(typeof resolve, "function");
  await act(async () => {
    resolve(jsonResponse(body, status));
  });
}

async function chooseMatch(act, id) {
  const selector = `input[type='radio'][value='${id}']`;
  await waitFor(act, () => document.querySelector(selector) !== null);
  await act(async () => {
    document.querySelector(selector).click();
  });
  const confirm = buttonByText("Confirm species");
  assert.ok(confirm);
  assert.equal(confirm.disabled, false);
  return confirm;
}

async function confirmMatch(act, id) {
  const confirm = await chooseMatch(act, id);
  await act(async () => {
    confirm.click();
  });
  await waitFor(act, () => text(document.body).includes("Selected species"));
}

const rexMatch = {
  external_species_id: "tyrannosaurus-rex",
  scientific_name: "Tyrannosaurus rex",
};

function enrichmentProposal(load, match = rexMatch) {
  const { assembleSpeciesEnrichmentProposal, SPECIES_ENRICHMENT_GENERATED_FIELDS } =
    load("@/lib/ai/speciesEnrichmentSchemas");
  const result = assembleSpeciesEnrichmentProposal({
    source: {
      id: match.external_species_id,
      scientific_name: match.scientific_name,
      diet_profile: "Carnivore",
      geological_period: null,
      region: null,
      social_requirements: "",
      general_care_recommendations: "",
      hybrid: false,
      franchise_origins: [],
      franchise_appearances: [],
    },
    retrievedAt: "2026-11-05T12:00:00Z",
    modelProposal: {
      ...Object.fromEntries(SPECIES_ENRICHMENT_GENERATED_FIELDS.map((field) => [field, null])),
      provenance: Object.fromEntries(SPECIES_ENRICHMENT_GENERATED_FIELDS.map((field) => [
        field,
        { basis: "api_interpretation", supporting_fields: [], uncertainty: "Limited data" },
      ])),
    },
  });
  assert.equal(result.ok, true);
  return result.data;
}

async function runDom(speciesRows, fn, supabase) {
  const installed = installDom();
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { QueryClientProvider } = require("@tanstack/react-query");
  const calls = [];
  const fetches = [];
  const fetchImpl = (url, init) => {
    calls.push({ url: String(url), init });
    return new Promise((resolve) => {
      fetches.push(resolve);
    });
  };
  const load = loadGraph(fetchImpl, speciesRows, supabase);
  const qc = load("@/lib/queryClient");
  if (!supabase) {
    // UI-only scenarios drive the verified store directly.
    const auth = load("@/lib/authQueryIsolation");
    auth.requestFreshAuthQuerySync = async () => qc.getVerifiedAuthSnapshot();
  }
  const client = qc.getQueryClient();
  client.setDefaultOptions({
    queries: { retry: false, gcTime: Infinity },
    mutations: { retry: false, gcTime: Infinity },
  });
  const root = createRoot(document.getElementById("root"));
  try {
    await fn({
      React,
      act,
      root,
      client,
      qc,
      load,
      calls,
      fetches,
      QueryClientProvider,
    });
  } finally {
    try {
      await act(async () => {
        root.unmount();
      });
      await act(async () => {
        for (const resolve of fetches.splice(0)) {
          resolve(jsonResponse({ ok: true, data: [] }));
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    } finally {
      client.clear();
      client.unmount();
      installed.restore();
    }
  }
}

test("species proposal UI is management-only and keeps external text unparsed", async () => {
  await runDom([], async ({
    React, act, root, client, qc, load, calls, fetches, QueryClientProvider,
  }) => {
    const app = load("./SpeciesDatabaseApp.tsx");
    const view = () => renderApp(React, QueryClientProvider, client, app);

    await act(async () => {
      grant(qc, "user-employee", "employee", "Eve");
      root.render(view());
    });
    assert.equal(document.querySelector("[role='tablist']"), null);
    assert.equal(text(document.body).includes("New Species Proposal"), false);
    assert.equal(text(document.body).includes("Which dinosaur would you like to add?"), false);
    assert.equal(calls.length, 0);

    await act(async () => {
      grant(qc, "user-senior", "senior", "Sam");
    });
    assert.equal(document.querySelector("[role='tablist']"), null);

    await act(async () => {
      grant(qc, "user-mgmt", "management", "Ada");
    });
    await openProposalTab(act);

    const markup = "<img src=x onerror=alert(1)>";
    await startSearch(act, calls, "Rex");
    assert.equal(calls[0].url, "/api/species/lookup?name=Rex");
    assert.equal(calls[0].url.includes("/api/agent/"), false);
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.credentials, "same-origin");
    assert.equal(calls[0].init.cache, "no-store");
    await finishSearch(act, fetches, {
      ok: true,
      data: [
        { external_species_id: "tyrannosaurus-rex", scientific_name: markup },
        { external_species_id: "tyrannosaurus", scientific_name: "Tyrannosaurus" },
      ],
    });
    await waitFor(act, () => text(document.body).includes("Did you mean one of these species?"));
    assert.equal(document.querySelector("img"), null);
    assert.equal(text(document.body).includes(markup), true);
    assert.equal(text(document.body).includes("tyrannosaurus-rex"), true);

    await confirmMatch(act, "tyrannosaurus-rex");
    assert.equal(text(document.body).includes("Selected species"), true);
    assert.equal(text(document.body).includes("tyrannosaurus-rex"), true);
    assert.equal(text(document.body).includes("Tyrannosaurus rex"), false);

    await act(async () => {
      qc.applyBrowserPermissionRead("user-mgmt", {
        status: "active",
        role: "employee",
        displayName: "Ada",
      });
    });
    assert.equal(text(document.body).includes("tyrannosaurus-rex"), false);
    assert.equal(text(document.body).includes(markup), false);
    assert.equal(text(document.body).includes("New Species Proposal"), false);
    assert.equal(document.querySelector("[role='tablist']"), null);
  });
});

test("a late lookup response does not reappear after access is revoked", async () => {
  await runDom([], async ({
    React, act, root, client, qc, load, calls, fetches, QueryClientProvider,
  }) => {
    const panel = load("./SpeciesProposalPanel.tsx");
    await act(async () => {
      grant(qc, "user-mgmt", "management", "Ada");
      root.render(React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(panel.SpeciesProposalPanel),
      ));
    });
    await startSearch(act, calls, "Rex");
    await act(async () => {
      qc.applyBrowserPermissionRead("user-mgmt", { status: "revoked" });
    });
    await finishSearch(act, fetches, {
      ok: true,
      data: [{
        external_species_id: "abelisaurus",
        scientific_name: "Abelisaurus comahuensis",
      }],
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(text(document.body).includes("Abelisaurus"), false);
    assert.equal(text(document.body).includes("abelisaurus"), false);
    assert.equal(document.querySelector("input[name='species-name']"), null);

    await act(async () => {
      grant(qc, "user-mgmt", "management", "Ada");
    });
    await waitFor(act, () => document.querySelector("input[name='species-name']") !== null);
    assert.equal(text(document.body).includes("Abelisaurus"), false);
    assert.equal(text(document.body).includes("abelisaurus"), false);
  });
});

test("a late lookup response does not reappear after leaving and reopening the tab", async () => {
  await runDom([], async ({
    React, act, root, client, qc, load, calls, fetches, QueryClientProvider,
  }) => {
    const app = load("./SpeciesDatabaseApp.tsx");
    await act(async () => {
      grant(qc, "user-mgmt", "management", "Ada");
      root.render(renderApp(React, QueryClientProvider, client, app));
    });
    await openProposalTab(act);
    await startSearch(act, calls, "Rex");
    const browse = buttonByText("Browse Species");
    await act(async () => {
      browse.click();
    });
    await waitFor(
      act,
      () => !text(document.body).includes("Which dinosaur would you like to add?"),
    );
    await finishSearch(act, fetches, {
      ok: true,
      data: [{
        external_species_id: "lateosaurus",
        scientific_name: "Lateosaurus antiquus",
      }],
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await openProposalTab(act);
    assert.equal(text(document.body).includes("Lateosaurus"), false);
    assert.equal(text(document.body).includes("lateosaurus"), false);
    assert.equal(text(document.body).includes("Did you mean"), false);
  });
});

test("changing the search text drops earlier matches and confirmation", async () => {
  await runDom([], async ({
    React, act, root, client, qc, load, calls, fetches, QueryClientProvider,
  }) => {
    const app = load("./SpeciesDatabaseApp.tsx");
    await act(async () => {
      grant(qc, "user-mgmt", "management", "Ada");
      root.render(renderApp(React, QueryClientProvider, client, app));
    });
    await openProposalTab(act);
    await startSearch(act, calls, "Rex");
    await finishSearch(act, fetches, {
      ok: true,
      data: [{
        external_species_id: "tyrannosaurus-rex",
        scientific_name: "Tyrannosaurus rex",
      }],
    });
    await waitFor(act, () => text(document.body).includes("Tyrannosaurus rex"));
    const input = document.querySelector("input[name='species-name']");
    await setInput(act, input, "Stegosaurus");
    await waitFor(act, () => !text(document.body).includes("Tyrannosaurus rex"));
    assert.equal(input.value, "Stegosaurus");
    assert.equal(document.querySelector("input[value='tyrannosaurus-rex']"), null);
    assert.equal(buttonByText("Confirm species"), null);

    await startSearch(act, calls, "Stegosaurus");
    await finishSearch(act, fetches, {
      ok: true,
      data: [{ external_species_id: "stegosaurus", scientific_name: "Stegosaurus" }],
    });
    await confirmMatch(act, "stegosaurus");
    assert.equal(document.querySelector("input[name='species-name']"), null);
    assert.match(text(document.body), /Selected species/);
    await act(async () => { buttonByText("Search again").click(); });
    await waitFor(act, () => document.querySelector("input[name='species-name']") !== null);
    await setInput(act, document.querySelector("input[name='species-name']"), "Triceratops");
    assert.equal(text(document.body).includes("Selected species"), false);
    assert.equal(text(document.body).includes("stegosaurus"), false);
  });
});

test("a confirm click cannot adopt lookup rows after the access epoch changes", async () => {
  await runDom([], async ({
    React, act, root, client, qc, load, calls, fetches, QueryClientProvider,
  }) => {
    const app = load("./SpeciesDatabaseApp.tsx");
    await act(async () => {
      grant(qc, "user-mgmt", "management", "Ada");
      root.render(renderApp(React, QueryClientProvider, client, app));
    });
    await openProposalTab(act);
    await startSearch(act, calls, "Rex");
    await finishSearch(act, fetches, {
      ok: true,
      data: [{
        external_species_id: "tyrannosaurus-rex",
        scientific_name: "Tyrannosaurus rex",
      }],
    });
    const confirm = await chooseMatch(act, "tyrannosaurus-rex");
    const epoch = qc.getVerifiedAuthSnapshot().accessEpoch;

    await act(async () => {
      qc.applyBrowserPermissionRead("user-mgmt", { status: "unavailable" });
      qc.applyBrowserPermissionRead("user-mgmt", {
        status: "active",
        role: "management",
        displayName: "Ada",
      });
      const current = qc.getVerifiedAuthSnapshot();
      assert.equal(current.role, "management");
      assert.equal(current.userId, "user-mgmt");
      assert.ok(
        current.accessEpoch > epoch,
        `epoch did not change (${epoch} -> ${current.accessEpoch})`,
      );
      assert.equal(confirm.isConnected, true);
      assert.equal(text(document.body).includes("Tyrannosaurus rex"), true);
      confirm.click();
    });

    assert.equal(text(document.body).includes("Selected species"), false);
    assert.equal(text(document.body).includes("Tyrannosaurus rex"), false);
  });
});

test("revoking management access clears a selection and recovery does not restore it", async () => {
  await runDom([], async ({
    React, act, root, client, qc, load, calls, fetches, QueryClientProvider,
  }) => {
    const app = load("./SpeciesDatabaseApp.tsx");
    await act(async () => {
      grant(qc, "user-mgmt", "management", "Ada");
      root.render(renderApp(React, QueryClientProvider, client, app));
    });
    await openProposalTab(act);
    await startSearch(act, calls, "Rex");
    await finishSearch(act, fetches, {
      ok: true,
      data: [{
        external_species_id: "tyrannosaurus-rex",
        scientific_name: "Tyrannosaurus rex",
      }],
    });
    await confirmMatch(act, "tyrannosaurus-rex");

    await act(async () => {
      qc.applyBrowserPermissionRead("user-mgmt", { status: "revoked" });
    });
    assert.equal(text(document.body).includes("Tyrannosaurus rex"), false);
    assert.equal(text(document.body).includes("Selected species"), false);
    assert.equal(text(document.body).includes("New Species Proposal"), false);
    assert.equal(document.querySelector("[role='tablist']"), null);

    await act(async () => {
      qc.applyBrowserPermissionRead("user-mgmt", {
        status: "active",
        role: "management",
        displayName: "Ada",
      });
    });
    await waitFor(act, () => buttonByText("New Species Proposal") !== null);
    assert.equal(text(document.body).includes("Tyrannosaurus rex"), false);
    assert.equal(text(document.body).includes("Which dinosaur would you like to add?"), false);
    await openProposalTab(act);
    assert.equal(text(document.body).includes("Tyrannosaurus rex"), false);
    assert.equal(text(document.body).includes("Selected species"), false);
    assert.equal(document.querySelector("input[name='species-name']").value, "");
  });
});

test("switching management accounts does not keep the previous selection", async () => {
  await runDom([], async ({
    React, act, root, client, qc, load, calls, fetches, QueryClientProvider,
  }) => {
    const app = load("./SpeciesDatabaseApp.tsx");
    await act(async () => {
      grant(qc, "user-mgmt-a", "management", "Ada");
      root.render(renderApp(React, QueryClientProvider, client, app));
    });
    await openProposalTab(act);
    await startSearch(act, calls, "Rex");
    await finishSearch(act, fetches, {
      ok: true,
      data: [{
        external_species_id: "tyrannosaurus-rex",
        scientific_name: "Tyrannosaurus rex",
      }],
    });
    await confirmMatch(act, "tyrannosaurus-rex");
    await waitFor(act, () => calls.length === 2);
    const resolvePreviousEnrichment = fetches.shift();

    await act(async () => {
      grant(qc, "user-mgmt-b", "management", "Bea");
    });
    await waitFor(act, () => !text(document.body).includes("tyrannosaurus-rex"));
    assert.equal(text(document.body).includes("Selected species"), false);
    if (!text(document.body).includes("Which dinosaur would you like to add?")) {
      await openProposalTab(act);
    }
    assert.equal(text(document.body).includes("tyrannosaurus-rex"), false);

    await startSearch(act, calls, "Abelisaurus");
    await finishSearch(act, fetches, {
      ok: true,
      data: [{
        external_species_id: "abelisaurus",
        scientific_name: "Abelisaurus comahuensis",
      }],
    });
    await confirmMatch(act, "abelisaurus");
    await waitFor(act, () => calls.length === 4);
    await finishSearch(act, fetches, {
      ok: true,
      data: enrichmentProposal(load, {
        external_species_id: "abelisaurus",
        scientific_name: "Abelisaurus comahuesis",
      }),
    });
    await waitFor(act, () => text(document.body).includes("TEMPORARY — NOT APPROVED OR SAVED"));
    await act(async () => {
      resolvePreviousEnrichment(jsonResponse({ ok: true, data: enrichmentProposal(load) }));
    });
    assert.match(text(document.body), /TEMPORARY — NOT APPROVED OR SAVED/);
    assert.match(text(document.body), /Abelisaurus comahuesis/);
    assert.equal(text(document.body).includes("tyrannosaurus-rex"), false);

    await act(async () => {
      grant(qc, "user-mgmt-a", "management", "Ada");
    });
    await waitFor(act, () => !text(document.body).includes("abelisaurus"));
    assert.equal(text(document.body).includes("Abelisaurus"), false);
    assert.equal(text(document.body).includes("tyrannosaurus-rex"), false);
    assert.equal(text(document.body).includes("Selected species"), false);
    assert.doesNotMatch(text(document.body), /TEMPORARY — NOT APPROVED OR SAVED/);
  });
});

test("remote management denial clears transient proposal state", async () => {
  await runDom([], async ({
    React, act, root, client, qc, load, calls, fetches, QueryClientProvider,
  }) => {
    const app = load("./SpeciesDatabaseApp.tsx");
    const auth = load("@/lib/authQueryIsolation");
    const originalSync = auth.requestAuthQuerySync;
    const originalFreshSync = auth.requestFreshAuthQuerySync;
    let syncs = 0;
    auth.requestAuthQuerySync = () => {
      syncs += 1;
      return originalSync();
    };
    await act(async () => {
      grant(qc, "user-mgmt", "management", "Ada");
      root.render(renderApp(React, QueryClientProvider, client, app));
    });
    await openProposalTab(act);

    await startSearch(act, calls, "Rex");
    await finishSearch(act, fetches, {
      ok: true,
      data: [{
        external_species_id: "tyrannosaurus-rex",
        scientific_name: "Tyrannosaurus rex",
      }],
    });
    await waitFor(act, () => text(document.body).includes("Tyrannosaurus rex"));

    await startSearch(act, calls, "Denied");
    await finishSearch(act, fetches, {
      ok: false,
      error: { code: "unauthorized", message: "secret provider text" },
    }, 403);
    await waitFor(act, () => text(document.body).includes("You do not have permission to perform this action."));
    assert.equal(syncs, 1);
    assert.equal(text(document.body).includes("secret provider text"), false);
    assert.equal(text(document.body).includes("Tyrannosaurus rex"), false);
    assert.equal(text(document.body).includes("tyrannosaurus-rex"), false);
    assert.equal(document.querySelector("input[type='radio']"), null);

    auth.requestFreshAuthQuerySync = () => {
      syncs += 1;
      qc.applyBrowserPermissionRead("user-mgmt", {
        status: "active",
        role: "senior",
        displayName: "Ada",
      });
      return originalFreshSync();
    };
    await startSearch(act, calls, "Rex");
    await finishSearch(act, fetches, {
      ok: true,
      data: [{
        external_species_id: "tyrannosaurus-rex",
        scientific_name: "Tyrannosaurus rex",
      }],
    });
    const confirm = await chooseMatch(act, "tyrannosaurus-rex");
    const syncsBeforeConfirm = syncs;
    await act(async () => {
      confirm.click();
    });
    await waitFor(act, () => document.querySelector("[role='tablist']") === null);
    assert.ok(syncs > syncsBeforeConfirm);
    assert.equal(text(document.body).includes("Selected species"), false);
    assert.equal(text(document.body).includes("Tyrannosaurus rex"), false);
    assert.equal(text(document.body).includes("tyrannosaurus-rex"), false);
  });
});

test("opening the proposal tab stops when the server role is no longer management", async () => {
  await runDom([], async ({
    React, act, root, client, qc, load, QueryClientProvider,
  }) => {
    const app = load("./SpeciesDatabaseApp.tsx");
    const auth = load("@/lib/authQueryIsolation");
    const originalSync = auth.requestFreshAuthQuerySync;
    auth.requestFreshAuthQuerySync = () => {
      qc.applyBrowserPermissionRead("user-mgmt", {
        status: "active",
        role: "employee",
        displayName: "Ada",
      });
      return originalSync();
    };
    await act(async () => {
      grant(qc, "user-mgmt", "management", "Ada");
      root.render(renderApp(React, QueryClientProvider, client, app));
    });
    const tab = [...document.querySelectorAll("[role='tab']")]
      .find((node) => text(node) === "New Species Proposal");
    assert.ok(tab);
    await act(async () => {
      tab.click();
    });
    await waitFor(act, () => document.querySelector("[role='tablist']") === null);
    assert.equal(text(document.body).includes("Which dinosaur would you like to add?"), false);
    assert.equal(text(document.body).includes("New Species Proposal"), false);
  });
});

for (const action of ["opening", "confirming"]) {
  test(`${action} requires a fresh Management read when claims verification fails`, async () => {
    const userId = "user-mgmt";
    let claimsError = null;
    let role = "management";
    let profileReads = 0;
    const supabase = {
      auth: {
        getClaims: async () => claimsError
          ? { data: null, error: claimsError }
          : { data: { claims: { sub: userId } }, error: null },
        getSession: async () => ({ data: { session: { user: { id: userId } } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          order: () => query,
          range: () => query,
          abortSignal: async () => ({ data: [], error: null }),
          maybeSingle: async () => {
            profileReads += 1;
            return { data: { role, display_name: "Ada" }, error: null };
          },
        };
        return query;
      },
    };

    await runDom([], async ({
      React, act, root, client, qc, load, calls, fetches, QueryClientProvider,
    }) => {
      const app = load("./SpeciesDatabaseApp.tsx");
      const auth = load("@/lib/authQueryIsolation");
      const stop = auth.startAuthQueryIsolation();
      try {
        await act(async () => {
          root.render(renderApp(React, QueryClientProvider, client, app));
        });
        await waitFor(act, () => buttonByText("New Species Proposal") !== null);
        let button = buttonByText("New Species Proposal");
        if (action === "confirming") {
          await openProposalTab(act);
          await startSearch(act, calls, "Rex");
          await finishSearch(act, fetches, {
            ok: true,
            data: [{ external_species_id: "tyrannosaurus-rex", scientific_name: "Tyrannosaurus rex" }],
          });
          button = await chooseMatch(act, "tyrannosaurus-rex");
        }
        const before = profileReads;
        role = "employee";
        claimsError = { name: "AuthRetryableFetchError" };
        await act(async () => { button.click(); });
        assert.equal(profileReads, before);
        assert.equal(qc.getVerifiedAuthSnapshot().role, "management");
        if (action === "opening") {
          assert.equal(Boolean(document.querySelector("input[name='species-name']")), false);
        } else {
          assert.equal(text(document.body).includes("Selected species"), false);
          assert.equal(buttonByText("Confirm species"), null);
        }
      } finally {
        stop();
      }
    }, supabase);
  });
}

test("the species browser keeps its search and selection across tabs", async () => {
  const rex = "11111111-1111-4111-8111-111111111111";
  const steg = "22222222-2222-4222-8222-222222222222";
  await runDom([
    localSpecies(rex, "Amber Rex"),
    localSpecies(steg, "Amber Stegosaurus"),
  ], async ({
    React, act, root, client, qc, load, QueryClientProvider,
  }) => {
    const app = load("./SpeciesDatabaseApp.tsx");
    await act(async () => {
      grant(qc, "user-mgmt", "management", "Ada");
      root.render(renderApp(React, QueryClientProvider, client, app));
    });
    await waitFor(act, () => text(document.body).includes("Amber Rex"));
    const search = document.querySelector("input");
    await setInput(act, search, "Steg");
    await waitFor(act, () => text(document.querySelector("h2")) === "Amber Stegosaurus");
    assert.equal(text(document.body).includes("Amber Rex"), false);
    assert.equal(text(document.querySelector("[aria-current='true']")), "Amber Stegosaurus");

    await openProposalTab(act);
    const browse = buttonByText("Browse Species");
    await act(async () => {
      browse.click();
    });
    await waitFor(act, () => document.querySelector("h2") !== null);
    const restored = document.querySelector("input");
    assert.equal(restored.value, "Steg");
    assert.equal(text(document.querySelector("h2")), "Amber Stegosaurus");
    assert.equal(text(document.querySelector("[aria-current='true']")), "Amber Stegosaurus");
  });
});

async function prepareEnrichment({ React, act, root, client, qc, load, calls, fetches, QueryClientProvider }) {
  const app = load("./SpeciesDatabaseApp.tsx");
  await act(async () => {
    grant(qc, "user-mgmt", "management", "Ada");
    root.render(renderApp(React, QueryClientProvider, client, app));
  });
  await openProposalTab(act);
  await startSearch(act, calls, "Rex");
  await finishSearch(act, fetches, { ok: true, data: [rexMatch] });
  return chooseMatch(act, rexMatch.external_species_id);
}

test("confirmation generates once and malformed or mismatched proposals require an explicit retry", async () => {
  await runDom([], async (h) => {
    const { act, calls, fetches, load } = h;
    const confirm = await prepareEnrichment(h);
    assert.equal(calls.length, 1);
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    await waitFor(act, () => calls.length === 2);
    assert.equal(text(document.querySelector("[role='status']")), "Generating species proposal…");
    assert.deepEqual(structuredClone(calls[1]), {
      url: "/api/agent/species-enrichment",
      init: {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: '{"external_species_id":"tyrannosaurus-rex"}',
      },
    });

    const proposal = enrichmentProposal(load);
    for (const [body, status] of [
      [{ ok: false, error: { code: "unauthorized", message: "provider detail" } }, 500],
      [{ ok: true, data: { ...proposal, provenance: {} } }, 200],
      [{
        ok: true,
        data: { ...proposal, api_facts: { ...proposal.api_facts, id: "abelisaurus" } },
      }, 200],
    ]) {
      const before = calls.length;
      await finishSearch(act, fetches, body, status);
      await waitFor(act, () => buttonByText("Retry generation") !== null);
      assert.equal(calls.length, before);
      assert.match(text(document.querySelector("[role='alert']")), /Unable to generate/);
      assert.doesNotMatch(text(document.body), /provider detail/);
      const retry = buttonByText("Retry generation");
      await act(async () => {
        retry.click();
        retry.click();
      });
      await waitFor(act, () => calls.length === before + 1);
      assert.equal(calls.at(-1).init.body, calls[1].init.body);
    }

    await finishSearch(act, fetches, { ok: true, data: proposal });
    await waitFor(act, () => text(document.body).includes("TEMPORARY — NOT APPROVED OR SAVED"));
    assert.equal(buttonByText("Retry generation"), null);
    assert.equal(buttonByText("Confirm species"), null);
    assert.equal(calls.length, 5);
  });
});

test("search again discards an in-flight proposal and suppresses duplicate generation", async () => {
  await runDom([], async (h) => {
    const { act, calls, fetches, load } = h;
    const confirm = await prepareEnrichment(h);
    await act(async () => { confirm.click(); });
    await waitFor(act, () => calls.length === 2);
    await act(async () => { buttonByText("Search again").click(); });
    await startSearch(act, calls, "Rex");
    const resolveEnrichment = fetches.shift();
    await finishSearch(act, fetches, { ok: true, data: [rexMatch] });
    await waitFor(act, () => document.querySelector("input[type='radio']") !== null);
    await act(async () => { document.querySelector("input[type='radio']").click(); });
    assert.equal(buttonByText("Confirm species").disabled, true);
    await act(async () => {
      resolveEnrichment(jsonResponse({ ok: true, data: enrichmentProposal(load) }));
    });
    await waitFor(act, () => !buttonByText("Confirm species").disabled);
    assert.equal(calls.length, 3);
    assert.doesNotMatch(text(document.body), /Selected species|TEMPORARY — NOT APPROVED OR SAVED/);
  });
});

test("an enrichment access denial clears selection and triggers auth sync", async () => {
  await runDom([], async (h) => {
    const { act, calls, fetches, load } = h;
    const auth = load("@/lib/authQueryIsolation");
    let syncs = 0;
    auth.requestAuthQuerySync = async () => { syncs += 1; };
    const confirm = await prepareEnrichment(h);
    await act(async () => { confirm.click(); });
    await waitFor(act, () => calls.length === 2);
    await finishSearch(act, fetches, { ok: false, error: { message: "provider detail" } }, 403);
    await waitFor(act, () => document.querySelector("[role='alert']") !== null);
    assert.match(text(document.querySelector("[role='alert']")), /You do not have permission/);
    assert.doesNotMatch(text(document.body), /provider detail|Selected species|tyrannosaurus-rex/);
    assert.equal(buttonByText("Retry generation"), null);
    assert.equal(syncs, 1);
  });
});

test("generation success is discarded if the fresh Management recheck finds a downgrade", async () => {
  await runDom([], async (h) => {
    const { act, calls, fetches, load, qc } = h;
    const confirm = await prepareEnrichment(h);
    await act(async () => { confirm.click(); });
    await waitFor(act, () => calls.length === 2);
    const auth = load("@/lib/authQueryIsolation");
    auth.requestFreshAuthQuerySync = async () => {
      qc.applyBrowserPermissionRead("user-mgmt", {
        status: "active", role: "employee", displayName: "Ada",
      });
      return qc.getVerifiedAuthSnapshot();
    };
    await finishSearch(act, fetches, { ok: true, data: enrichmentProposal(load) });
    await waitFor(act, () => buttonByText("New Species Proposal") === null);
    assert.doesNotMatch(text(document.body), /Selected species|TEMPORARY — NOT APPROVED OR SAVED/);
    await act(async () => {
      grant(qc, "user-mgmt", "management", "Ada");
    });
    auth.requestFreshAuthQuerySync = async () => qc.getVerifiedAuthSnapshot();
    await openProposalTab(act);
    assert.doesNotMatch(text(document.body), /Selected species|TEMPORARY — NOT APPROVED OR SAVED/);
  });
});

test("the proposal tab shows lookup, generation, and review as separate stages", async () => {
  await runDom([], async (h) => {
    const { act, calls, fetches, load } = h;
    const confirm = await prepareEnrichment(h);
    const body = () => text(document.body);
    assert.ok(document.querySelector("input[name='species-name']"));
    assert.match(body(), /Which dinosaur would you like to add\?/);
    assert.doesNotMatch(body(), /Generating species proposal|TEMPORARY — NOT APPROVED OR SAVED/);

    await act(async () => { confirm.click(); });
    await waitFor(act, () => body().includes("Generating species proposal"));
    assert.equal(document.querySelector("input[name='species-name']"), null);
    assert.doesNotMatch(body(), /Which dinosaur would you like to add\?/);
    assert.match(body(), /Selected species/);
    assert.match(body(), /Tyrannosaurus rex/);
    assert.match(body(), /tyrannosaurus-rex/);
    assert.ok(buttonByText("Search again"));
    assert.doesNotMatch(body(), /TEMPORARY — NOT APPROVED OR SAVED/);

    await finishSearch(act, fetches, { ok: true, data: enrichmentProposal(load) });
    await waitFor(act, () => body().includes("TEMPORARY — NOT APPROVED OR SAVED"));
    assert.equal((body().match(/TEMPORARY — NOT APPROVED OR SAVED/g) ?? []).length, 1);
    assert.equal(document.querySelector("input[name='species-name']"), null);
    assert.doesNotMatch(body(), /Which dinosaur would you like to add\?|Selected species/);
    assert.match(body(), /Untrusted external data/);
    assert.match(body(), /Agent proposal/);
    for (const label of [
      "General description",
      "Diet preferences",
      "Habitat preferences",
      "Handling guidance",
      "Minimum handlers",
      "Safety class",
    ]) {
      assert.ok(body().includes(label), label);
    }
    assert.match(body(), /Retrieved\s+2026-11-05T12:00:00Z/);
    assert.ok(buttonByText("Search again"));
    assert.equal(calls.length, 2);

    await act(async () => { buttonByText("Search again").click(); });
    await waitFor(act, () => document.querySelector("input[name='species-name']") !== null);
    assert.match(body(), /Which dinosaur would you like to add\?/);
    assert.doesNotMatch(body(), /TEMPORARY — NOT APPROVED OR SAVED|Generating species proposal/);
  });
});
