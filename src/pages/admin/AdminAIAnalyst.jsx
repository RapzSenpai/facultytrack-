import { useState, useRef, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";

// Phase 8 (Req 4 / Req 6): admin AI chatbox. The chat talks to the
// admin-analyst Edge Function, which computes a FIXED aggregate
// digest server-side — the model never touches the database, never
// sees comments or student identity. Every Q&A is audit-logged.
// Scope [D9] is enforced in the function from the caller's program
// assignments; the scope banner shows what the AI may see.

const SUGGESTED_QUESTIONS = [
  "Which program has the lowest average rating and how big is the gap to the next one?",
  "List the faculty who need the most attention right now.",
  "Which evaluation criteria are our weakest overall?",
  "Where are the biggest participation gaps this period?",
  "How do the averages trend across the periods we have released?",
  "Summarize the moderation picture: how many flagged and priority cases?",
];

const SUGGESTION_CHIPS = SUGGESTED_QUESTIONS.map((q) => {
  const idx = q.indexOf("and");
  const short = idx > 0 ? q.slice(0, idx).replace(/[?.]$/, "") : q.replace(/[?.]$/, "");
  return { full: q, short: short.length <= 46 ? short : short.slice(0, 46) + "…" };
});

let localId = 0;

export default function AdminAIAnalyst() {
  const [messages, setMessages] = useState([
    {
      id: (localId += 1),
      role: "assistant",
      text:
        "Ask me anything about your evaluation data. I can only analyze aggregate statistics from RELEASED periods — ratings, programs, criteria, participation, and moderation counts. I never have access to comments or student identity.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [scope, setScope] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  const ask = async (question) => {
    const q = (question ?? "").trim();
    if (!q || thinking) return;
    setInput("");
    setMessages((m) => [
      ...m,
      { id: (localId += 1), role: "user", text: q },
    ]);
    setThinking(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-analyst", {
        body: { question: q },
      });
      if (error) {
        let msg = "The AI analyst is temporarily unavailable. Please try again.";
        try {
          const errBody = await error.context.json();
          if (errBody?.error) msg = errBody.error;
        } catch {
          /* keep default */
        }
        setMessages((m) => [
          ...m,
          { id: (localId += 1), role: "assistant", text: msg, isError: true },
        ]);
      } else if (data) {
        if (data.scope) setScope(data.scope);
        setMessages((m) => [
          ...m,
          { id: (localId += 1), role: "assistant", text: data.answer },
        ]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { id: (localId += 1), role: "assistant", text: "Could not reach the AI analyst service.", isError: true },
      ]);
    } finally {
      setThinking(false);
    }
  };

  const scopeLabel = scope
    ? typeof scope.programs === "string"
      ? scope.programs
      : Array.isArray(scope.programs) && scope.programs.length > 0
        ? scope.programs.join(", ")
        : "your assigned programs"
    : "your assigned programs";

  return (
    <AdminLayout title="AI Analyst">
      <section style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
        {/* Scope + disclosure header */}
        <div
          style={{
            background: "#0f172a",
            color: "#e2e8f0",
            borderRadius: "12px",
            padding: "16px 20px",
            marginBottom: "16px",
            display: "flex",
            gap: "14px",
            alignItems: "flex-start",
            flexWrap: "wrap",
            justifyContent: "space-between",
          }}
        >
          <div style={{ maxWidth: "620px" }}>
            <div style={{ fontWeight: 800, fontSize: "14px", marginBottom: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ background: "#4f46e5", borderRadius: "999px", padding: "3px 10px", fontSize: "10.5px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                AI-generated answers
              </span>
            </div>
            <div style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.55 }}>
              The analyst answers over a fixed set of pre-computed statistics only — it cannot query raw records,
              read comments, or see student identity. Every question and answer is recorded in the audit log.
            </div>
          </div>
          <div style={{ fontSize: "12.5px", color: "#94a3b8", textAlign: "right" }}>
            <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: "2px" }}>Data scope</div>
            <div>{scopeLabel}</div>
            <div style={{ marginTop: "2px" }}>Released periods only</div>
          </div>
        </div>

        {/* Chat window */}
        <div
          ref={scrollRef}
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            height: "56vh",
            minHeight: "360px",
            overflowY: "auto",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "78%",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  fontSize: "13.5px",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  ...(m.role === "user"
                    ? { background: "#0f172a", color: "#fff", borderBottomRightRadius: "4px" }
                    : m.isError
                      ? { background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderBottomLeftRadius: "4px" }
                      : { background: "#f1f5f9", color: "#1f2937", borderBottomLeftRadius: "4px" }),
                }}
              >
                {m.role === "assistant" && !m.isError && (
                  <div style={{ fontSize: "10.5px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px", color: "#6366f1", marginBottom: "6px" }}>
                    AI-generated
                  </div>
                )}
                {m.text}
              </div>
            </div>
          ))}
          {thinking && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ background: "#f1f5f9", color: "#6b7280", borderRadius: "12px", borderBottomLeftRadius: "4px", padding: "12px 16px", fontSize: "13px" }}>
                Analyzing released statistics…
              </div>
            </div>
          )}
        </div>

        {/* Suggestions */}
        {messages.length <= 2 && !thinking && (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
            {SUGGESTION_CHIPS.map((chip) => (
              <button
                key={chip.full}
                type="button"
                onClick={() => ask(chip.full)}
                style={{
                  background: "#eef2ff",
                  color: "#4f46e5",
                  border: "1px solid #c7d2fe",
                  borderRadius: "999px",
                  padding: "6px 14px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {chip.short}
              </button>
            ))}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          style={{ display: "flex", gap: "10px", marginTop: "14px" }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about program averages, weak criteria, participation, moderation counts…"
            maxLength={1000}
            disabled={thinking}
            style={{
              flex: 1,
              border: "1px solid #d1d5db",
              borderRadius: "10px",
              padding: "12px 16px",
              fontSize: "14px",
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={thinking || !input.trim()}
            style={{
              background: thinking || !input.trim() ? "#94a3b8" : "#0f172a",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              padding: "12px 22px",
              fontSize: "14px",
              fontWeight: 700,
              cursor: thinking ? "wait" : "pointer",
            }}
          >
            {thinking ? "…" : "Ask"}
          </button>
        </form>
      </section>
    </AdminLayout>
  );
}
