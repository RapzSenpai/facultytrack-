import { useRef, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import {
  useAIAnalyst,
  SUGGESTED_QUESTIONS,
  QUICK_CHIPS,
} from "../../context/AIAnalystContext";
import {
  Sparkles,
  Send,
  RotateCcw,
  Copy,
  Check,
  BarChart3,
  Users,
  Target,
  PieChart,
} from "lucide-react";

const CARD_ICONS = [BarChart3, Users, Target, PieChart];

export default function AdminAIAnalyst() {
  const {
    messages,
    input,
    setInput,
    thinking,
    scope,
    ask,
    clearChat,
    copiedId,
    copyText,
  } = useAIAnalyst();

  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, thinking]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  };

  const scopeLabel = scope
    ? typeof scope.programs === "string"
      ? scope.programs
      : Array.isArray(scope.programs) && scope.programs.length > 0
      ? scope.programs.join(", ")
      : "Assigned Programs"
    : "Assigned Programs";

  return (
    <AdminLayout title="EvalIQ">
      <div className="ad-content" style={{ display: "flex", flexDirection: "column", height: "100%", padding: "16px 24px", overflowY: "auto" }}>
        <div className="ad-aiStudio">
          {/* Executive Header & Scope Bar */}
          <section className="ad-aiHeader">
            <div className="ad-aiHeaderLeft">
              <div className="ad-aiTitleRow">
                <span className="ad-aiTitle">EvalIQ Studio</span>
                <span className="ad-aiBadge">
                  <Sparkles size={11} /> Released Aggregate Engine
                </span>
              </div>
              <div className="ad-aiSub">
                Direct intelligence query over released faculty evaluations. Student
                identities, tokens, and qualitative comments are strictly redacted by
                server-side RLS.
              </div>
            </div>

            <div className="ad-aiHeaderRight">
              <div className="ad-aiScopeTag">
                <span className="ad-aiScopeDot" />
                <strong>Scope:</strong> {scopeLabel}
              </div>
              <button
                type="button"
                className="ad-aiBtnClear"
                onClick={clearChat}
                title="Reset conversation"
              >
                <RotateCcw size={12} />
                <span>Reset Session</span>
              </button>
            </div>
          </section>

          {/* Chat Window */}
          <section className="ad-aiChatContainer">
            <div className="ad-aiMessages" ref={scrollRef}>
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.role === "user"
                      ? "ad-aiMsgUser"
                      : `ad-aiMsgAssistant ${m.isError ? "ad-aiMsgError" : ""}`
                  }
                >
                  {m.role === "assistant" && !m.isError && (
                    <div className="ad-aiMsgHeader">
                      <span>EvalIQ Assistant</span>
                      <button
                        type="button"
                        className="ad-aiMsgCopyBtn"
                        onClick={() => copyText(m.id, m.text)}
                      >
                        {copiedId === m.id ? (
                          <>
                            <Check size={12} color="#10b981" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy size={12} />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                  {m.text}
                </div>
              ))}

              {/* 4 Interactive Starter Cards (Inside the chat view when fresh) */}
              {messages.length <= 1 && (
                <div className="ad-aiLaunchpad">
                  {SUGGESTED_QUESTIONS.map((card, idx) => {
                    const Icon = CARD_ICONS[idx % CARD_ICONS.length];
                    return (
                      <button
                        key={idx}
                        type="button"
                        className="ad-aiLaunchCard"
                        onClick={() => ask(card.prompt)}
                        disabled={thinking}
                      >
                        <div className="ad-aiLaunchCardTop">
                          <span className="ad-aiLaunchBadge">{card.category}</span>
                          <Icon size={15} color="#2563eb" />
                        </div>
                        <div className="ad-aiLaunchTitle">{card.title}</div>
                        <div className="ad-aiLaunchPrompt">“{card.prompt}”</div>
                        <div className="ad-aiLaunchDesc">{card.desc}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              {thinking && (
                <div className="ad-aiThinking">
                  <span className="ad-aiDots">
                    <span className="ad-aiDot" />
                    <span className="ad-aiDot" />
                    <span className="ad-aiDot" />
                  </span>
                  <span>Synthesizing aggregate statistics…</span>
                </div>
              )}
            </div>

            {/* Unified Composer */}
            <div className="ad-aiComposerArea">
              <div className="ad-aiChipsRow">
                {QUICK_CHIPS.map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="ad-aiChip"
                    onClick={() => ask(chip)}
                    disabled={thinking}
                  >
                    {chip}
                  </button>
                ))}
              </div>

              <div className="ad-aiInputBar">
                <input
                  type="text"
                  className="ad-aiInput"
                  placeholder="Ask EvalIQ about program averages, criteria weaknesses, participation gaps, or moderation…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={thinking}
                  maxLength={1000}
                />
                <button
                  type="button"
                  className="ad-aiSendBtn"
                  onClick={() => ask(input)}
                  disabled={thinking || !input.trim()}
                >
                  <Send size={14} />
                  <span>Send</span>
                </button>
              </div>

              <div className="ad-aiDisclaimer">
                All queries and digests are securely logged in the admin audit trail.
                Answers are generated strictly over released periods.
              </div>
            </div>
          </section>
        </div>
      </div>
    </AdminLayout>
  );
}
