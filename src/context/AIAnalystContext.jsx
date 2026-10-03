import { createContext, useContext, useState } from "react";
import { supabase } from "../config/supabase";

const AIAnalystContext = createContext(null);

export const SUGGESTED_QUESTIONS = [
  {
    title: "Program Rankings",
    category: "Benchmarks",
    prompt: "Which program has the lowest average rating and how big is the gap to the next one?",
    desc: "Compare performance averages between departments",
  },
  {
    title: "At-Risk Faculty",
    category: "Attention",
    prompt: "List the faculty who need the most attention right now.",
    desc: "Identify faculty members scoring below standard threshold",
  },
  {
    title: "Weakest Criteria",
    category: "Diagnostics",
    prompt: "Which evaluation criteria are our weakest overall?",
    desc: "Discover evaluation domains with the lowest student satisfaction",
  },
  {
    title: "Participation Gaps",
    category: "Coverage",
    prompt: "Where are the biggest participation gaps this period?",
    desc: "Spot sections with incomplete or low student evaluation rates",
  },
];

export const QUICK_CHIPS = [
  "How do averages trend across released periods?",
  "Summarize the moderation picture: flagged & priority cases",
  "Which criteria had the highest ratings?",
  "List programs with highest participation",
];

let localId = 100;

export function AIAnalystProvider({ children }) {
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: "assistant",
      text: "Welcome to EvalIQ. Ask me anything about your evaluation data. I analyze aggregate statistics from RELEASED periods — ratings, programs, criteria, participation, and moderation counts. I never have access to comments or student identity.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [scope, setScope] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const ask = async (question) => {
    const q = (question ?? "").trim();
    if (!q || thinking) return;
    setInput("");
    const newMsgId = (localId += 1);
    setMessages((prev) => [...prev, { id: newMsgId, role: "user", text: q }]);
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
        setMessages((prev) => [
          ...prev,
          { id: (localId += 1), role: "assistant", text: msg, isError: true },
        ]);
      } else if (data) {
        if (data.scope) setScope(data.scope);
        setMessages((prev) => [
          ...prev,
          { id: (localId += 1), role: "assistant", text: data.answer },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: (localId += 1), role: "assistant", text: "Could not reach the AI analyst service.", isError: true },
      ]);
    } finally {
      setThinking(false);
    }
  };

  const clearChat = () => {
    setMessages([
      {
        id: 1,
        role: "assistant",
        text: "Welcome to EvalIQ. Ask me anything about your evaluation data. I analyze aggregate statistics from RELEASED periods — ratings, programs, criteria, participation, and moderation counts. I never have access to comments or student identity.",
      },
    ]);
    setInput("");
  };

  const copyText = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleDrawer = () => setIsDrawerOpen((v) => !v);

  return (
    <AIAnalystContext.Provider
      value={{
        messages,
        input,
        setInput,
        thinking,
        scope,
        isDrawerOpen,
        setIsDrawerOpen,
        toggleDrawer,
        ask,
        clearChat,
        copiedId,
        copyText,
      }}
    >
      {children}
    </AIAnalystContext.Provider>
  );
}

export function useAIAnalyst() {
  const ctx = useContext(AIAnalystContext);
  if (!ctx) {
    throw new Error("useAIAnalyst must be used within an AIAnalystProvider");
  }
  return ctx;
}
