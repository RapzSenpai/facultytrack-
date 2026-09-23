import { useEffect, useMemo, useState } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { logAdminAction } from "../../utils/audit";

// Phase 6 [D7]: priority cases are handled by Admin. This page is
// the queue + the moderation triage surface + blocked-words CRUD.
// Comments (incl. original_comment) are visible HERE only — faculty
// never receive them (D6).

const STATUS_COLORS = {
  new: "#dc2626",
  acknowledged: "#d97706",
  resolved: "#16a34a",
  dismissed: "#9ca3af",
};

const MOD_COLORS = {
  allow: "#16a34a",
  flag: "#d97706",
  block: "#dc2626",
};

export default function AdminModeration() {
  const [loading, setLoading] = useState(true);
  const [evaluations, setEvaluations] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [words, setWords] = useState([]);
  const [faculty, setFaculty] = useState([]);
  const [tab, setTab] = useState("priority"); // priority | flagged | words
  const [newWord, setNewWord] = useState("");
  const [newSeverity, setNewSeverity] = useState("flag");
  const [savingWord, setSavingWord] = useState(false);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [evalRes, reviewRes, wordsRes, facRes] = await Promise.all([
          supabase.from("admin_evaluations_anon").select("*"),
          supabase.from("priority_reviews").select("*").order("created_at", { ascending: false }),
          supabase.from("blocked_words").select("*").order("word"),
          supabase.from("users").select("id, full_name").eq("role", "faculty"),
        ]);
        setEvaluations(evalRes.data || []);
        setReviews(reviewRes.data || []);
        setWords(wordsRes.data || []);
        setFaculty(facRes.data || []);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const evalById = useMemo(() => {
    const m = new Map();
    for (const e of evaluations) m.set(e.id, e);
    return m;
  }, [evaluations]);

  const facultyName = (id) =>
    faculty.find((f) => f.id === id)?.full_name || "Unknown faculty";

  const openReviews = reviews.filter((r) => r.status === "new" || r.status === "acknowledged");

  const flaggedEvals = evaluations.filter((e) => e.moderation_status === "flag");

  const updateReview = async (review, patch) => {
    setBusyId(review.id);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const terminal = patch.status === "resolved" || patch.status === "dismissed";
      // Sparse update: only send resolved_* when transitioning to a
      // terminal state (never overwrite with undefined).
      const update = terminal
        ? { ...patch, resolved_by: userData?.user?.id, resolved_at: new Date().toISOString() }
        : { status: patch.status };
      const { error } = await supabase
        .from("priority_reviews")
        .update(update)
        .eq("id", review.id);
      if (error) throw error;
      setReviews((prev) => prev.map((r) => (r.id === review.id ? { ...r, ...update } : r)));
      logAdminAction("priority_review.update", "priority_reviews", review.id, { status: patch.status });
    } catch (err) {
      console.error("Failed to update review:", err);
      alert("Could not update the review. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const setModeration = async (evaluation, status) => {
    setBusyId(evaluation.id);
    try {
      const { error } = await supabase
        .from("evaluations")
        .update({ moderation_status: status })
        .eq("id", evaluation.id);
      if (error) throw error;
      setEvaluations((prev) =>
        prev.map((e) => (e.id === evaluation.id ? { ...e, moderation_status: status } : e)),
      );
      logAdminAction("evaluation.moderate", "evaluations", evaluation.id, { moderation_status: status });
    } catch (err) {
      console.error("Failed to reclassify:", err);
      alert("Could not update the moderation status. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const addWord = async () => {
    const word = newWord.trim().toLowerCase();
    if (!word || savingWord) return;
    setSavingWord(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("blocked_words")
        .insert({ word, severity: newSeverity, created_by: userData?.user?.id })
        .select()
        .single();
      if (error) {
        if (error.code === "23505") {
          alert("That word is already on the list.");
          return;
        }
        throw error;
      }
      setWords((prev) => [...prev, data].sort((a, b) => a.word.localeCompare(b.word)));
      setNewWord("");
      logAdminAction("blocked_words.add", "blocked_words", data.id, { word, severity: newSeverity });
    } catch (err) {
      console.error("Failed to add word:", err);
      alert("Could not add the word. Please try again.");
    } finally {
      setSavingWord(false);
    }
  };

  const removeWord = async (word) => {
    try {
      const { error } = await supabase.from("blocked_words").delete().eq("id", word.id);
      if (error) throw error;
      setWords((prev) => prev.filter((w) => w.id !== word.id));
      logAdminAction("blocked_words.remove", "blocked_words", word.id, { word: word.word });
    } catch (err) {
      console.error("Failed to remove word:", err);
      alert("Could not remove the word. Please try again.");
    }
  };

  const renderEvalContext = (evaluation) => {
    if (!evaluation) return <em style={{ color: "#9ca3af" }}>Evaluation not found</em>;
    return (
      <div style={{ fontSize: "13px", color: "#374151", lineHeight: 1.5 }}>
        <div><strong>{facultyName(evaluation.faculty_id)}</strong> · {evaluation.academic_year} {evaluation.semester}</div>
        {evaluation.original_comment && (
          <div style={{ marginTop: "6px", padding: "8px 12px", background: "#f8fafc", borderLeft: "3px solid #3b82f6", borderRadius: "6px" }}>
            “{evaluation.original_comment}”
          </div>
        )}
        <div style={{ marginTop: "6px", fontSize: "12px", color: "#6b7280" }}>
          moderation: <strong style={{ color: MOD_COLORS[evaluation.moderation_status] || "#6b7280" }}>{evaluation.moderation_status}</strong>
          {evaluation.priority_source && <> · priority source: <strong>{evaluation.priority_source}</strong></>}
        </div>
      </div>
    );
  };

  return (
    <AdminLayout title="Moderation & Priority">
      <section className="ad-content">
        <div className="ad-welcomeHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h2 className="ad-title">Moderation &amp; Priority</h2>
            <p className="ad-subtitle">
              Priority concerns [D7], flagged comments (Req 3), and the blocked-words list.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
          {[
            { key: "priority", label: `Priority Queue (${openReviews.length})` },
            { key: "flagged", label: `Flagged Comments (${flaggedEvals.length})` },
            { key: "words", label: `Blocked Words (${words.length})` },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: "8px 18px",
                borderRadius: "999px",
                border: tab === t.key ? "none" : "1px solid #e5e7eb",
                background: tab === t.key ? "#1e3a5f" : "#fff",
                color: tab === t.key ? "#fff" : "#374151",
                fontWeight: 700,
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="ad-tableCard" style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>
            Loading moderation data...
          </div>
        ) : (
          <>
            {/* PRIORITY QUEUE [D7] */}
            {tab === "priority" && (
              <div className="ad-tableCard">
                <div className="fd-tableHeader" style={{ padding: "20px 24px", borderBottom: "1px solid #f1f5f9" }}>
                  <h3 className="fd-tableTitle" style={{ fontSize: "14px", fontWeight: 800, textTransform: "uppercase" }}>
                    Priority Reviews — {openReviews.length} open
                  </h3>
                </div>
                <div className="ad-tableWrap">
                  <table className="ad-table">
                    <thead>
                      <tr>
                        <th>PRIORITY CONCERN</th>
                        <th>STATUS</th>
                        <th style={{ textAlign: "right" }}>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviews.length === 0 ? (
                        <tr><td colSpan="3" style={{ textAlign: "center", padding: "24px", color: "#6b7280" }}>No priority reviews yet.</td></tr>
                      ) : (
                        reviews.map((r) => {
                          const evaluation = evalById.get(r.evaluation_id);
                          return (
                            <tr key={r.id}>
                              <td style={{ maxWidth: "520px" }}>{renderEvalContext(evaluation)}</td>
                              <td>
                                <span style={{
                                  padding: "4px 12px",
                                  borderRadius: "999px",
                                  fontSize: "12px",
                                  fontWeight: 700,
                                  color: STATUS_COLORS[r.status],
                                  background: `${STATUS_COLORS[r.status]}15`,
                                }}>
                                  {r.status}
                                </span>
                              </td>
                              <td className="ad-tableActions" style={{ justifyContent: "flex-end", gap: "6px", flexWrap: "wrap" }}>
                                {r.status === "new" && (
                                  <button
                                    type="button"
                                    className="ad-actionBtn ad-actionBtn--view"
                                    disabled={busyId === r.id}
                                    onClick={() => updateReview(r, { status: "acknowledged" })}
                                  >
                                    Acknowledge
                                  </button>
                                )}
                                {(r.status === "new" || r.status === "acknowledged") && (
                                  <>
                                    <button
                                      type="button"
                                      className="ad-actionBtn--approve"
                                      disabled={busyId === r.id}
                                      onClick={() => updateReview(r, { status: "resolved", resolution_note: "Reviewed and handled by admin." })}
                                    >
                                      Resolve
                                    </button>
                                    <button
                                      type="button"
                                      className="ad-actionBtn ad-actionBtn--delete"
                                      disabled={busyId === r.id}
                                      onClick={() => updateReview(r, { status: "dismissed", resolution_note: "Dismissed by admin." })}
                                    >
                                      Dismiss
                                    </button>
                                  </>
                                )}
                                {r.status === "resolved" && r.resolution_note && (
                                  <span style={{ fontSize: "12px", color: "#6b7280" }}>{r.resolution_note}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* FLAGGED COMMENTS (Req 3 triage) */}
            {tab === "flagged" && (
              <div className="ad-tableCard">
                <div className="fd-tableHeader" style={{ padding: "20px 24px", borderBottom: "1px solid #f1f5f9" }}>
                  <h3 className="fd-tableTitle" style={{ fontSize: "14px", fontWeight: 800, textTransform: "uppercase" }}>
                    Flagged &amp; Unreviewed Comments
                  </h3>
                </div>
                <div className="ad-tableWrap">
                  <table className="ad-table">
                    <thead>
                      <tr>
                        <th>COMMENT</th>
                        <th>MODERATION</th>
                        <th style={{ textAlign: "right" }}>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flaggedEvals.length === 0 ? (
                        <tr><td colSpan="3" style={{ textAlign: "center", padding: "24px", color: "#6b7280" }}>Nothing flagged. 🎉</td></tr>
                      ) : (
                        flaggedEvals.map((e) => {
                          const unreviewed = e.moderation_labels?.unreviewed === true;
                          return (
                            <tr key={e.id}>
                              <td style={{ maxWidth: "520px" }}>
                                {renderEvalContext(e)}
                                {unreviewed && (
                                  <div style={{ marginTop: "6px", fontSize: "12px", fontWeight: 700, color: "#d97706" }}>
                                    ⚠ Wordlist-only verdict (AI was unavailable) — please re-review.
                                  </div>
                                )}
                              </td>
                              <td>
                                <span style={{
                                  padding: "4px 12px",
                                  borderRadius: "999px",
                                  fontSize: "12px",
                                  fontWeight: 700,
                                  color: MOD_COLORS[e.moderation_status],
                                  background: `${MOD_COLORS[e.moderation_status]}15`,
                                }}>
                                  {e.moderation_status}
                                </span>
                              </td>
                              <td className="ad-tableActions" style={{ justifyContent: "flex-end", gap: "6px", flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  className="ad-actionBtn--approve"
                                  disabled={busyId === e.id}
                                  onClick={() => setModeration(e, "allow")}
                                >
                                  Allow
                                </button>
                                <button
                                  type="button"
                                  className="ad-actionBtn ad-actionBtn--delete"
                                  disabled={busyId === e.id}
                                  onClick={() => setModeration(e, "block")}
                                >
                                  Withhold
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* BLOCKED WORDS CRUD */}
            {tab === "words" && (
              <div className="ad-tableCard">
                <div className="fd-tableHeader" style={{ padding: "20px 24px", borderBottom: "1px solid #f1f5f9" }}>
                  <h3 className="fd-tableTitle" style={{ fontSize: "14px", fontWeight: 800, textTransform: "uppercase" }}>
                    Blocked Words (tier-1 filter)
                  </h3>
                </div>
                <div style={{ padding: "20px 24px" }}>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
                    <input
                      type="text"
                      value={newWord}
                      onChange={(e) => setNewWord(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addWord()}
                      placeholder="Add a word or phrase..."
                      style={{ flex: "1 1 220px", padding: "9px 12px", borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "14px" }}
                    />
                    <select
                      value={newSeverity}
                      onChange={(e) => setNewSeverity(e.target.value)}
                      style={{ padding: "9px 12px", borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "14px" }}
                    >
                      <option value="flag">Flag (review)</option>
                      <option value="block">Block (reject submission)</option>
                    </select>
                    <button
                      type="button"
                      className="ad-btnSearch"
                      onClick={addWord}
                      disabled={savingWord || !newWord.trim()}
                      style={{ opacity: savingWord || !newWord.trim() ? 0.6 : 1 }}
                    >
                      {savingWord ? "Adding..." : "Add Word"}
                    </button>
                  </div>
                  {words.length === 0 ? (
                    <div style={{ textAlign: "center", color: "#6b7280", padding: "16px", fontSize: "14px" }}>
                      No blocked words yet. The AI classifier still runs on every comment.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {words.map((w) => (
                        <span
                          key={w.id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "6px 12px",
                            borderRadius: "999px",
                            fontSize: "13px",
                            fontWeight: 600,
                            border: "1px solid #e5e7eb",
                            background: w.severity === "block" ? "#fef2f2" : "#fffbeb",
                            color: w.severity === "block" ? "#b91c1c" : "#92400e",
                          }}
                        >
                          {w.word}
                          <small style={{ fontWeight: 800, opacity: 0.75 }}>{w.severity}</small>
                          <button
                            type="button"
                            onClick={() => removeWord(w)}
                            title="Remove"
                            style={{ border: "none", background: "transparent", cursor: "pointer", fontWeight: 800, color: "inherit" }}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p style={{ marginTop: "14px", fontSize: "12.5px", color: "#6b7280" }}>
                    <strong>Block</strong> rejects the submission outright; <strong>Flag</strong> stores it for review here.
                    Legit criticism never matches these rules — the AI tier is instructed to allow professional negative feedback.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </AdminLayout>
  );
}
