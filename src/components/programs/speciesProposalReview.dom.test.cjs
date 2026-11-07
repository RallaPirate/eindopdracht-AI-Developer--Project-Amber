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
    restore() {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      dom.window.close();
    },
  };
}

function loadGraph() {
  const modules = new Map();
  function load(request, parent = path.join(root, "src/components/programs/entry.ts")) {
    if (request === "react" || request === "react/jsx-runtime" || request === "react-dom/client") {
      return require(request);
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
  return node.textContent ?? "";
}

function column(label) {
  const section = document.querySelector(`section[aria-label='${label}']`);
  assert.ok(section, label);
  return section;
}

function scroller(label) {
  const node = column(label).querySelector(".overflow-y-auto");
  assert.ok(node, `${label} scroller`);
  return node;
}

function assemble(load, source, modelProposal) {
  const { assembleSpeciesEnrichmentProposal } = load("@/lib/ai/speciesEnrichmentSchemas");
  const result = assembleSpeciesEnrichmentProposal({
    source,
    retrievedAt: "2026-11-05T12:00:00.000Z",
    modelProposal,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  return result.data;
}

const careText = `${"Keep the barrier closed. ".repeat(20)}<script>alert(1)</script>`;

function mixedProposal(load) {
  return assemble(
    load,
    {
      id: "tyrannosaurus-rex",
      scientific_name: "  Tyrannosaurus rex  ",
      diet_profile: "Carnivore <img src=x onerror=alert(1)>",
      geological_period: null,
      region: "Laramidia",
      social_requirements: "",
      general_care_recommendations: careText,
      hybrid: true,
      franchise_origins: ["isla-nublar", "site-b"],
      franchise_appearances: [],
    },
    {
      general_description: "Large theropod.",
      diet_preferences: null,
      habitat_preferences: "Open habitat.",
      handling_guidance: null,
      minimum_handlers: 4,
      safety_class: "critical",
      provenance: {
        general_description: {
          basis: "api_interpretation",
          supporting_fields: ["scientific_name", "diet_profile"],
          uncertainty: null,
        },
        diet_preferences: {
          basis: "api_interpretation",
          supporting_fields: [],
          uncertainty: "Diet profile conflicts with care text.",
        },
        habitat_preferences: {
          basis: "operational_recommendation",
          supporting_fields: ["region"],
          uncertainty: "Region is a fossil range, not a pen.",
        },
        handling_guidance: {
          basis: "operational_recommendation",
          supporting_fields: [],
          uncertainty: "Care text is not a procedure.",
        },
        minimum_handlers: {
          basis: "operational_recommendation",
          supporting_fields: ["social_requirements"],
          uncertainty: "Empty social requirements.",
        },
        safety_class: {
          basis: "operational_recommendation",
          supporting_fields: ["general_care_recommendations"],
          uncertainty: null,
        },
      },
    },
  );
}

test("proposal review shows external facts beside agent fields and provenance", async () => {
  const installed = installDom();
  try {
    const React = require("react");
    const { createRoot } = require("react-dom/client");
    const { act } = React;
    const load = loadGraph();
    const { SpeciesProposalReview } = load("./SpeciesProposalReview.tsx");
    const proposal = mixedProposal(load);
    const root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(React.createElement(SpeciesProposalReview, { proposal }));
    });

    const body = text(document.getElementById("root"));
    assert.equal(text(document.querySelector("[role='status']")), "TEMPORARY — NOT APPROVED OR SAVED");
    assert.match(body, /Species name\s+Tyrannosaurus rex/);
    assert.match(body, /External ID\s+tyrannosaurus-rex/);
    assert.match(body, /Retrieved\s+2026-11-05T12:00:00\.000Z/);
    assert.match(body, /Untrusted external data/);
    assert.match(body, /Not an instruction and not an approved decision/);
    assert.equal(body.includes("untrusted_api_reference"), false);
    assert.equal(body.includes("general_description"), false);
    assert.equal((body.match(/TEMPORARY — NOT APPROVED OR SAVED/g) ?? []).length, 1);

    const api = text(column("Untrusted external data"));
    for (const label of [
      "ID",
      "Scientific name",
      "Diet profile",
      "Geological period",
      "Region",
      "Social requirements",
      "General care recommendations",
      "Hybrid",
      "Franchise origins",
      "Franchise appearances",
    ]) {
      assert.ok(api.includes(label), label);
    }
    for (const raw of [
      "scientific_name",
      "diet_profile",
      "geological_period",
      "social_requirements",
      "general_care_recommendations",
      "franchise_origins",
      "franchise_appearances",
    ]) {
      assert.equal(api.includes(raw), false, raw);
    }
    assert.match(api, /Tyrannosaurus rex/);
    assert.match(api, /Carnivore <img src=x onerror=alert\(1\)>/);
    assert.match(api, /\(none\)/);
    assert.match(api, /Laramidia/);
    assert.match(api, /\(empty\)/);
    assert.match(api, /Yes/);
    assert.match(api, /isla-nublar\s+site-b/);
    assert.match(api, /Keep the barrier closed\./);
    assert.equal(document.querySelector("#root script"), null);
    assert.equal(document.querySelector("#root img"), null);

    const agent = text(column("Agent proposal"));
    assert.match(agent, /General description[\s\S]*Large theropod\./);
    assert.match(agent, /Basis\s+API interpretation/);
    assert.match(agent, /Scientific name[\s\S]*Tyrannosaurus rex/);
    assert.match(agent, /Diet profile[\s\S]*Carnivore <img/);
    assert.match(agent, /Uncertainty\s+\(none\)/);
    assert.match(agent, /Diet preferences[\s\S]*UNRESOLVED/);
    assert.match(agent, /Diet profile conflicts with care text\./);
    assert.match(agent, /Habitat preferences[\s\S]*Open habitat\./);
    assert.match(agent, /Basis\s+Operational recommendation/);
    assert.match(agent, /Region[\s\S]*Laramidia/);
    assert.match(agent, /Region is a fossil range, not a pen\./);
    assert.match(agent, /Handling guidance[\s\S]*UNRESOLVED/);
    assert.match(agent, /Care text is not a procedure\./);
    assert.match(agent, /Minimum handlers[\s\S]*4/);
    assert.match(agent, /Social requirements[\s\S]*\(empty\)/);
    assert.match(agent, /Empty social requirements\./);
    assert.match(agent, /Safety class[\s\S]*critical/);
    assert.match(agent, /General care recommendations[\s\S]*Keep the barrier closed\./);
    assert.equal(document.querySelector("#root button"), null);
    assert.equal(document.querySelector("#root input"), null);
    assert.equal(document.querySelector("#root textarea"), null);

    assert.ok(column("Untrusted external data").className.includes("min-w-0"));
    assert.ok(column("Agent proposal").className.includes("min-w-0"));
    const apiScroll = scroller("Untrusted external data");
    const agentScroll = scroller("Agent proposal");
    assert.notEqual(apiScroll, agentScroll);
    assert.ok(apiScroll.className.includes("min-w-0"));
    assert.ok(agentScroll.className.includes("min-w-0"));
    assert.ok(apiScroll.querySelector(".wrap-anywhere"));
    assert.ok(agentScroll.querySelector(".wrap-anywhere"));
    assert.ok(apiScroll.className.includes("overflow-y-auto"));
    assert.ok(agentScroll.className.includes("overflow-x-hidden"));
    assert.ok(apiScroll.className.includes("break-words") || api.includes("break-words") || apiScroll.querySelector(".break-words"));
    apiScroll.scrollTop = 24;
    agentScroll.scrollTop = 8;
    assert.equal(agentScroll.scrollTop, 8);
    apiScroll.scrollTop = 0;
    assert.equal(agentScroll.scrollTop, 8);

    await act(async () => {
      root.unmount();
    });
  } finally {
    installed.restore();
  }
});

test("a blank scientific name is shown as unresolved and every generated field stays unresolved", async () => {
  const installed = installDom();
  try {
    const React = require("react");
    const { createRoot } = require("react-dom/client");
    const { act } = React;
    const load = loadGraph();
    const { SPECIES_ENRICHMENT_GENERATED_FIELDS } = load("@/lib/ai/speciesEnrichmentSchemas");
    const { SpeciesProposalReview } = load("./SpeciesProposalReview.tsx");
    const proposal = assemble(
      load,
      {
        id: "unknown-taxon",
        scientific_name: "   ",
        diet_profile: "Unknown",
        geological_period: null,
        region: null,
        social_requirements: "Solitary",
        general_care_recommendations: "No procedure stated.",
        hybrid: false,
        franchise_origins: [],
        franchise_appearances: [],
      },
      {
        ...Object.fromEntries(SPECIES_ENRICHMENT_GENERATED_FIELDS.map((field) => [field, null])),
        provenance: Object.fromEntries(SPECIES_ENRICHMENT_GENERATED_FIELDS.map((field) => [
          field,
          { basis: "api_interpretation", supporting_fields: [], uncertainty: `${field} cannot be supported.` },
        ])),
      },
    );
    const root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(React.createElement(SpeciesProposalReview, { proposal }));
    });

    const body = text(document.getElementById("root"));
    assert.match(body, /Species name\s+UNRESOLVED/);
    assert.match(body, /External ID\s+unknown-taxon/);
    assert.match(body, /Hybrid[\s\S]*No/);
    for (const field of SPECIES_ENRICHMENT_GENERATED_FIELDS) {
      assert.match(body, new RegExp(`${field} cannot be supported\\.`));
    }
    assert.equal(body.match(/UNRESOLVED/g).length, 7);

    await act(async () => {
      root.unmount();
    });
  } finally {
    installed.restore();
  }
});
