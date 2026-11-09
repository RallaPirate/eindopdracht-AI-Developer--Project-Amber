/* eslint-disable @typescript-eslint/no-require-imports -- Existing Node/jsdom harness pattern. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

async function harness(fetchImpl) {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://amber.test" });
  const previous = new Map();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const React = require("react");
  const { act } = React;
  const { createRoot } = require("react-dom/client");
  let snapshot = { status: "ready", userId: "A", role: "employee", accessEpoch: 1 };
  const listeners = new Set();
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  const getSnapshot = () => snapshot;
  const file = path.join(__dirname, "AssistantApp.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  const execute = vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { window, document, console, fetch: fetchImpl, AbortController, AbortSignal, Response, ReadableStream, TextEncoder, Error }, { filename: file });
  execute((id) => {
    if (id === "@/hooks/useAuthenticatedQuery") return { useVerifiedAuthSnapshot: () => React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot) };
    if (id === "@/lib/queryClient") return { getVerifiedAuthSnapshot: getSnapshot, subscribeVerifiedAuthSnapshot: subscribe };
    return require(id);
  }, loaded, loaded.exports);
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(loaded.exports.AssistantApp)));
  async function until(predicate) {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    }
    assert.ok(predicate(), document.body.textContent);
  }
  return {
    act, until,
    body: () => document.body.textContent,
    button: (label) => [...document.querySelectorAll("button")].find((b) => b.textContent === label),
    async submit(value) {
      await act(async () => {
        const input = document.querySelector("input");
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await act(async () => document.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    },
    async access(change) { await act(async () => { snapshot = { ...snapshot, ...change }; [...listeners].forEach((listener) => listener()); }); },
    async close() { await act(async () => root.unmount()); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); },
  };
}

function liveResponse(messageId = "answer") {
  let output;
  let closed = false;
  const response = new Response(new ReadableStream({ start(c) { output = c; }, cancel() { closed = true; } }), { headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } });
  const push = (part) => { if (!closed) output.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(part)}\n\n`)); };
  return {
    response, push,
    start(value) { push({ type: "start", messageId }); push({ type: "start-step" }); push({ type: "text-start", id: "t" }); push({ type: "text-delta", id: "t", delta: value }); },
    finish() { if (closed) return; push({ type: "text-end", id: "t" }); push({ type: "finish-step" }); push({ type: "finish", finishReason: "stop" }); output.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); output.close(); closed = true; },
  };
}

test("real useChat renders incremental text and tool activity, stops, and replays text only", async () => {
  const streams = []; const bodies = []; let aborted = false;
  const h = await harness(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    options.signal.addEventListener("abort", () => { aborted = true; }, { once: true });
    const stream = liveResponse(); streams.push(stream); return stream.response;
  });
  try {
    await h.submit("First question"); await h.until(() => streams.length === 1);
    await h.act(async () => {
      streams[0].start("First incremental text");
      streams[0].push({ type: "tool-input-available", toolCallId: "lookup", toolName: "searchSpecies", input: { query: "Bramble" } });
    });
    await h.until(() => h.body().includes("First incremental text") && h.body().includes("Species search: working"));
    assert.equal(h.button("Send").disabled, true); assert.equal(h.button("Stop").disabled, false);
    await h.act(async () => h.button("Stop").click());
    await h.until(() => h.button("Stop").disabled);
    assert.equal(aborted, true); assert.match(h.body(), /Stopped|incomplete/);
    await h.submit("Second question"); await h.until(() => streams.length === 2);
    const history = bodies[1].messages;
    assert.deepEqual(Object.keys(bodies[1]), ["messages"]);
    assert.ok(history.every((m) => m.parts.length === 1 && m.parts[0].type === "text"));
    assert.doesNotMatch(JSON.stringify(bodies[1]), /toolCallId|lookup/);
    await h.act(async () => { streams[1].start("<img src=x onerror=alert(1)> Safe text"); streams[1].finish(); });
    await h.until(() => h.body().includes("Safe text") && h.button("Stop").disabled);
    assert.equal(document.querySelector("#root img"), null);
  } finally { await h.close(); }
});

test("Stop marks only the cancelled response's unfinished tools and preserves history after another answer", async () => {
  const streams = [];
  const h = await harness(async () => {
    const stream = liveResponse(`answer-${streams.length}`);
    streams.push(stream);
    return stream.response;
  });
  const indicators = () => [...document.querySelectorAll("[role=log] p")].map((p) => p.textContent).filter((text) => /^(Species search|Weather retrieval):/.test(text));
  try {
    await h.submit("First complete answer"); await h.until(() => streams.length === 1);
    await h.act(async () => {
      streams[0].start("First answer");
      streams[0].push({ type: "tool-input-available", toolCallId: "first", toolName: "searchSpecies", input: { query: "Bramble" } });
      streams[0].push({ type: "tool-output-available", toolCallId: "first", output: { ok: true } });
      streams[0].finish();
    });
    await h.until(() => h.button("Stop").disabled);
    assert.deepEqual(indicators(), ["Species search: complete"]);

    await h.submit("Interrupt this answer"); await h.until(() => streams.length === 2);
    await h.act(async () => {
      streams[1].start("Partial answer");
      streams[1].push({ type: "tool-input-available", toolCallId: "weather", toolName: "getWeather", input: { date: "2026-11-08" } });
      streams[1].push({ type: "tool-output-available", toolCallId: "weather", output: { ok: true } });
      streams[1].push({ type: "tool-input-available", toolCallId: "pending", toolName: "searchSpecies", input: { query: "Bramble" } });
      streams[1].push({ type: "tool-input-start", toolCallId: "streaming", toolName: "getWeather" });
    });
    await h.until(() => indicators().includes("Weather retrieval: working…"));
    assert.deepEqual(indicators(), ["Species search: complete", "Weather retrieval: complete", "Species search: working…", "Weather retrieval: working…"]);
    await h.act(async () => h.button("Stop").click());
    await h.until(() => h.button("Stop").disabled);
    const cancelledIndicators = ["Species search: complete", "Weather retrieval: complete", "Species search: interrupted", "Weather retrieval: interrupted"];
    assert.deepEqual(indicators(), cancelledIndicators);
    assert.match(document.querySelector("[role=log]").textContent, /Response interrupted\. This answer is incomplete\./);
    await h.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    assert.deepEqual(indicators(), cancelledIndicators);

    await h.submit("Next successful question"); await h.until(() => streams.length === 3);
    assert.deepEqual(indicators(), cancelledIndicators);
    assert.match(document.querySelector("[role=log]").textContent, /Response interrupted\. This answer is incomplete\./);
    await h.act(async () => {
      streams[2].start("Next successful answer");
      streams[2].push({ type: "tool-input-available", toolCallId: "next", toolName: "searchSpecies", input: { query: "Bramble" } });
      streams[2].push({ type: "tool-output-available", toolCallId: "next", output: { ok: true } });
      streams[2].finish();
    });
    await h.until(() => h.body().includes("Next successful answer") && h.button("Stop").disabled);
    assert.deepEqual(indicators(), [...cancelledIndicators, "Species search: complete"]);
    assert.equal((document.querySelector("[role=log]").textContent.match(/Response interrupted\. This answer is incomplete\./g) ?? []).length, 1);
  } finally { await h.close(); }
});

test("normal completion and stream errors are not labelled as cancellations", async () => {
  for (const failure of [false, true]) {
    let stream;
    const h = await harness(async () => { stream = liveResponse(); return stream.response; });
    try {
      await h.submit("Question"); await h.until(() => Boolean(stream));
      await h.act(async () => {
        stream.start("An answer");
        stream.push({ type: "tool-input-available", toolCallId: "lookup", toolName: "searchSpecies", input: { query: "Bramble" } });
        if (failure) stream.push({ type: "error", errorText: "Safe test failure" });
        else stream.push({ type: "tool-output-available", toolCallId: "lookup", output: { ok: true } });
        stream.finish();
      });
      await h.until(() => h.button("Stop").disabled);
      assert.doesNotMatch(document.querySelector("[role=log]").textContent, /interrupted|incomplete/);
      if (failure) assert.match(h.body(), /could not complete/);
      else assert.match(h.body(), /Species search: complete/);
    } finally { await h.close(); }
  }
});

test("HTTP failure is sanitized and Send recovers without a reload", async () => {
  let attempt = 0;
  const h = await harness(async () => {
    if (++attempt === 1) return new Response("SECRET_INTERNAL_PROVIDER_BODY", { status: 503 });
    const stream = liveResponse(); stream.start("Recovered answer"); stream.finish(); return stream.response;
  });
  try {
    await h.submit("Fail"); await h.until(() => h.body().includes("could not complete"));
    assert.doesNotMatch(h.body(), /SECRET/); assert.equal(document.querySelector("input").disabled, false);
    await h.submit("Try again"); await h.until(() => h.body().includes("Recovered answer"));
    assert.doesNotMatch(h.body(), /could not complete/); assert.equal(attempt, 2);
  } finally { await h.close(); }
});

test("account, role, epoch and suspended access cancel streams, clear state and discard late output", async () => {
  for (const change of [{ userId: "B", accessEpoch: 2 }, { role: "management", accessEpoch: 2 }, { accessEpoch: 2 }, { status: "suspended" }]) {
    let stream; let aborted = false;
    const h = await harness(async (_url, options) => { options.signal.addEventListener("abort", () => { aborted = true; }, { once: true }); stream = liveResponse(); return stream.response; });
    try {
      await h.submit("A private question"); await h.until(() => Boolean(stream));
      await h.act(async () => stream.start("A private answer"));
      await h.until(() => h.body().includes("A private answer"));
      await h.access(change);
      assert.equal(aborted, true);
      await h.act(async () => { stream.push({ type: "text-delta", id: "t", delta: "LATE PRIVATE OUTPUT" }); });
      assert.doesNotMatch(h.body(), /A private|LATE PRIVATE/);
      if (change.status === "suspended") await h.access({ status: "ready", accessEpoch: 2 });
      assert.equal(document.querySelector("input").value, "");
      assert.doesNotMatch(h.body(), /A private|LATE PRIVATE/);
    } finally { await h.close(); }
  }
});

test("completed assistant markdown bold renders as text, and an open marker stays literal", async () => {
  let stream;
  const h = await harness(async () => { stream = liveResponse(); return stream.response; });
  try {
    assert.match(h.body(), /Local species guidance · classified offshore reserve weather · temporary chat/);
    await h.submit("**not assistant text**");
    await h.until(() => Boolean(stream));
    assert.match(h.body(), /\*\*not assistant text\*\*/);
    await h.act(async () => stream.start("See **Br"));
    await h.until(() => h.body().includes("See **Br"));
    assert.equal(document.querySelector("#root strong"), null);
    await h.act(async () => {
      stream.push({ type: "text-delta", id: "t", delta: "ambleback** nearby. **<img src=x>**" });
      stream.finish();
    });
    await h.until(() => document.querySelectorAll("#root strong").length === 2);
    const strong = [...document.querySelectorAll("#root strong")].map((node) => node.textContent);
    assert.deepEqual(strong, ["Brambleback", "<img src=x>"]);
    assert.equal(document.querySelector("#root img"), null);
    assert.match(h.body(), /See Brambleback nearby\./);
    assert.match(h.body(), /\*\*not assistant text\*\*/);
    assert.doesNotMatch(document.querySelector("[role=log]").textContent, /\*\*Br|\*\*<img/);
  } finally { await h.close(); }
});

test("closing Assistant cancels its active stream", async () => {
  let aborted = false;
  const h = await harness(async (_url, options) => { options.signal.addEventListener("abort", () => { aborted = true; }, { once: true }); return liveResponse().response; });
  await h.submit("Question"); await h.until(() => !h.button("Stop").disabled);
  await h.close(); assert.equal(aborted, true);
});
