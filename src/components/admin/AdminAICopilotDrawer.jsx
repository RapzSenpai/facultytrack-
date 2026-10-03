import { useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAIAnalyst, QUICK_CHIPS } from "../../context/AIAnalystContext";
import {
  Sparkles,
  Send,
  RotateCcw,
  X,
  Maximize2,
  Copy,
  Check,
} from "lucide-react";

export default function AdminAICopilotDrawer() {
  const {
    messages,
    input,
    setInput,
    thinking,
    isDrawerOpen,
    setIsDrawerOpen,
    ask,
    clearChat,
    copiedId,
    copyText,
  } = useAIAnalyst();

  const navigate = useNavigate();
  const scrollRef = useRef(null);

  useEffect(() => {
    if (isDrawerOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, thinking, isDrawerOpen]);

  if (!isDrawerOpen) return null;

  const handleExpand = () => {
    setIsDrawerOpen(false);
    navigate("/admin/ai-analyst");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  };

  return (
    <>
      <div
        className="ad-copilotBackdrop"
        onClick={() => setIsDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside className="ad-copilotDrawer" aria-label="EvalIQ Assistant Drawer">
        {/* Header */}
        <div className="ad-copilotDrawerHeader">
          <div className="ad-copilotDrawerTitle">
            <Sparkles size={18} color="#f5c400" />
            <span>EvalIQ Assistant</span>
          </div>
          <div className="ad-copilotDrawerActions">
            <button
              type="button"
              className="ad-copilotIconBtn"
              onClick={handleExpand}
              title="Open full page"
            >
              <Maximize2 size={15} />
            </button>
            <button
              type="button"
              className="ad-copilotIconBtn"
              onClick={clearChat}
              title="Clear conversation"
            >
              <RotateCcw size={15} />
            </button>
            <button
              type="button"
              className="ad-copilotIconBtn"
              onClick={() => setIsDrawerOpen(false)}
              title="Close drawer"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Messages */}
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

          {thinking && (
            <div className="ad-aiThinking">
              <span className="ad-aiDots">
                <span className="ad-aiDot" />
                <span className="ad-aiDot" />
                <span className="ad-aiDot" />
              </span>
              <span>Analyzing released statistics…</span>
            </div>
          )}
        </div>

        {/* Composer & Quick Chips */}
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
              placeholder="Ask EvalIQ anything about evaluation stats…"
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
            </button>
          </div>

          <div className="ad-aiDisclaimer">
            Audit-logged aggregates only. Student identity is strictly redacted.
          </div>
        </div>
      </aside>
    </>
  );
}
