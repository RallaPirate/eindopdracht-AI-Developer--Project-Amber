"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { useVerifiedAuthSnapshot } from "@/hooks/useAuthenticatedQuery";
import { getVerifiedAuthSnapshot, subscribeVerifiedAuthSnapshot } from "@/lib/queryClient";

type ChatMessage = UIMessage<{ incomplete?: boolean }>;
type Owner = { userId: string; role: string; accessEpoch: number };

function current(owner: Owner) {
  const access = getVerifiedAuthSnapshot();
  return access.status === "ready" && access.userId === owner.userId && access.role === owner.role && access.accessEpoch === owner.accessEpoch;
}

export function AssistantApp() {
  const access = useVerifiedAuthSnapshot();
  if (access.status !== "ready" || !access.userId || !access.role) return <p role="status">Verifying Assistant access…</p>;
  return <AssistantChat key={`${access.userId}:${access.role}:${access.accessEpoch}`} owner={{ userId: access.userId, role: access.role, accessEpoch: access.accessEpoch }} />;
}

function AssistantChat({ owner: initialOwner }: { owner: Owner }) {
  const [owner] = useState(initialOwner);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const [transport] = useState(() => new DefaultChatTransport<ChatMessage>({
    api: "/api/agent", credentials: "same-origin",
    prepareSendMessagesRequest: ({ messages }) => {
      if (!current(owner)) throw new Error("Access changed");
      // Only conversational text is replayed. Tool output and metadata never
      // cross the trust boundary back into the server's evidence context.
      const history = messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({
        id: m.id, role: m.role,
        parts: [{ type: "text" as const, text: m.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n").slice(0, 2_000) }],
      })).filter((m) => m.parts[0].text.trim()).slice(-20);
      while (new TextEncoder().encode(JSON.stringify({ messages: history })).byteLength > 32_768 && history.length > 1) history.shift();
      return { body: { messages: history } };
    },
    fetch: async (url, options) => {
      if (!current(owner)) throw new Error("Access changed");
      const controller = new AbortController();
      const signal = options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
      const unsubscribe = subscribeVerifiedAuthSnapshot(() => { if (!current(owner)) controller.abort(); });
      let handedOff = false;
      try {
        const response = await fetch(url, { ...options, signal, cache: "no-store" });
        if (!current(owner)) throw new Error("Access changed");
        if (!response.body) return response;
        const reader = response.body.getReader();
        const cancel = () => { void reader.cancel().catch(() => {}); unsubscribe(); };
        signal.addEventListener("abort", cancel, { once: true });
        const cleanup = () => { signal.removeEventListener("abort", cancel); unsubscribe(); };
        handedOff = true;
        return new Response(new ReadableStream({
          async pull(output) {
            try {
              const chunk = await reader.read();
              if (!current(owner) || signal.aborted) throw new Error("Access changed or stopped");
              if (chunk.done) { cleanup(); output.close(); }
              else output.enqueue(chunk.value);
            } catch { cleanup(); output.error(new Error("The Assistant stream was interrupted.")); }
          },
          async cancel() { controller.abort(); cleanup(); await reader.cancel().catch(() => {}); },
        }), { status: response.status, statusText: response.statusText, headers: response.headers });
      } finally { if (!handedOff) unsubscribe(); }
    },
  }));
  const { messages, sendMessage, status, error, stop, clearError, setMessages } = useChat<ChatMessage>({
    transport,
    onFinish: ({ isAbort, isError, message }) => {
      if (current(owner) && (isAbort || isError || message.metadata?.incomplete)) setNotice("The answer is incomplete. You can send another question.");
    },
  });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const reset = () => {
      if (!current(owner)) { void stop(); setMessages([]); setInput(""); setNotice(""); clearError(); }
    };
    const unsubscribe = subscribeVerifiedAuthSnapshot(reset);
    reset();
    return () => { unsubscribe(); void stop(); setMessages([]); };
  }, [owner, stop, setMessages, clearError]);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [messages, status]);

  return (
    <section aria-label="Operational Assistant" className="flex h-full min-h-0 flex-col gap-2 text-sm">
      <p className="shrink-0 text-xs">Local species guidance · offshore Costa Rica weather · temporary chat</p>
      <div ref={scroll} role="log" aria-label="Conversation" aria-live="polite" className="os-bevel-in min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        {messages.length === 0 && <p>Ask about a local species or the weather. Reports, specimens and knowledge-index evidence are unavailable in this Assistant.</p>}
        {messages.map((message) => <div key={message.id}>
          <p className="font-bold">{message.role === "user" ? "You" : "Assistant"}</p>
          {message.parts.map((part, index) => {
            if (part.type === "text") return <p key={index} className="whitespace-pre-wrap break-words">{part.text}</p>;
            if (isToolUIPart(part)) {
              const failed = part.state === "output-error" || (part.state === "output-available" && typeof part.output === "object" && part.output !== null && "ok" in part.output && part.output.ok === false);
              return <p key={index} className="text-xs">{part.type === "tool-searchSpecies" ? "Species search" : "Weather retrieval"}: {failed ? "data unavailable" : part.state === "output-available" ? "complete" : "working…"}</p>;
            }
            return null;
          })}
        </div>)}
      </div>
      {busy && <p role="status">{status === "submitted" ? "Connecting…" : "Assistant is responding…"}</p>}
      {error && <p role="alert">The Assistant could not complete this request. Please try again.</p>}
      {notice && <p role="status">{notice}</p>}
      <form className="flex shrink-0 gap-2" onSubmit={(event) => {
        event.preventDefault();
        const text = input.trim();
        if (!text || busy || !current(owner)) return;
        clearError(); setNotice(""); setInput("");
        void sendMessage({ text }).catch(() => { if (current(owner)) setNotice("The request failed. Please try again."); });
      }}>
        <input aria-label="Message" value={input} maxLength={2_000} onChange={(event) => setInput(event.target.value)} disabled={busy} placeholder="Ask the Assistant…" className="os-bevel-in min-w-0 flex-1 bg-[var(--os-graphite)] px-2 py-1" />
        <button className="os-bevel-button px-3 py-1 disabled:opacity-50" type="submit" disabled={busy || !input.trim()}>Send</button>
        <button className="os-bevel-button px-3 py-1 disabled:opacity-50" type="button" disabled={!busy} onClick={() => { void stop(); setNotice("Stopped. The answer may be incomplete."); }}>Stop</button>
      </form>
    </section>
  );
}
