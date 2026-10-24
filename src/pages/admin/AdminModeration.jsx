import { useEffect, useMemo, useState } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import { useDialog } from "../../context/DialogContext";
import { useScopedAdmin } from "../../hooks/useScopedAdmin";
import { useSuperScope } from "../../context/SuperScopeContext";
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
  const { currentUser } = useAuth();
  const { showNotice, showConfirm } = useDialog();
  const { isSuper, myDeptIds, inScopeName, loading: scopeLoading } = useScopedAdmin();
  const { scopeDeptId, scopeDeptName } = useSuperScope();
  const sameDept = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  // Super program picker: a pick pins fallback tools to that program.
  const inPicked = (id, name) => scopeDeptId && (id === scopeDeptId || sameDept(name, scopeDeptName));
  // Super pick overrides the always-true super branch of inScopeName.
  const scopeNameMatch = (name) => isSuper
    ? (!scopeDeptId || sameDept(name, scopeDeptName))
    : inScopeName(name);
  // D9 strict: evaluation belongs to a program via its faculty (primary)
  // or the responding student's department (fallback). Super sees all.
  const inScopeFaculty = (f) => (isSuper && !scopeDeptId)
    || (f?.department_id && myDeptIds.includes(f.department_id))
    || scopeNameMatch(f?.department)
    || inPicked(f?.department_id, f?.department);
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
  const [statusFilter, setStatusFilter] = useState("all"); // all | new | acknowledged | resolved | dismissed
  const [search, setSearch] = useState("");
  const [resolveTarget, setResolveTarget] = useState(null);
  const [resolveNote, setResolveNote] = useState("");

  useEffect(() => {
    const load = async () => {
      if (scopeLoading) return;
      try {
        const [evalRes, reviewRes, wordsRes, facRes] = await Promise.all([
          supabase.from("admin_evaluations_anon").select("*"),
          supabase.from("priority_reviews").select("*").order("created_at", { ascending: false }),
          supabase.from("blocked_words").select("*").order("word"),
          supabase.from("users").select("id, full_name, department, department_id").eq("role", "faculty"),
        ]);
        const fac = facRes.data || [];
        const facById = new Map(fac.map((f) => [f.id, f]));
        const inScopeEval = (e) => (isSuper && !scopeDeptId)
          || inScopeFaculty(facById.get(e.faculty_id))
          || scopeNameMatch(e.student_department)
          || (scopeDeptId && sameDept(e.student_department, scopeDeptName));
        const scopedEvals = (evalRes.data || []).filter(inScopeEval);
        const scopedIds = new Set(scopedEvals.map((e) => e.id));
        setEvaluations(scopedEvals);
        // Fail-closed: reviews pointing at out-of-scope (or missing)
        // evaluations never reach a scoped admin's queue.
        setReviews((reviewRes.data || []).filter((r) => (isSuper && !scopeDeptId) || scopedIds.has(r.evaluation_id)));
        setWords(wordsRes.data || []);
        setFaculty(fac.filter((f) => (isSuper && !scopeDeptId) || inScopeFaculty(f)));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [scopeLoading, isSuper, myDeptIds.join("|"), scopeDeptId, scopeDeptName]);

  const evalById = useMemo(() => {
    const m = new Map();
    for (const e of evaluations) m.set(e.id, e);
    return m;
  }, [evaluations]);

  const facultyName = (id) =>
    faculty.find((f) => f.id === id)?.full_name || "Unknown faculty";

  const facultyDept = (id) =>
    faculty.find((f) => f.id === id)?.department?.trim() || "Unassigned";

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
      // RLS-filtered writes return success with zero rows — verify.
      const { data, error } = await supabase
        .from("priority_reviews")
        .update(update)
        .eq("id", review.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        showNotice("No change saved — this case is outside your program scope.", {
          type: "warning",
          title: "Program Scope Notice",
        });
        return;
      }
      setReviews((prev) => prev.map((r) => (r.id === review.id ? { ...r, ...update } : r)));
      logAdminAction("priority_review.update", "priority_reviews", review.id, { status: patch.status });
    } catch (err) {
      console.error("Failed to update review:", err);
      showNotice("Could not update the review. Please try again.", {
        type: "error",
        title: "Update Failed",
      });
    } finally {
      setBusyId(null);
    }
  };

  const setModeration = async (evaluation, status) => {
    setBusyId(evaluation.id);
    try {
      // RLS-filtered writes return success with zero rows — verify
      // before touching local state, or Allow looks saved until refresh.
      const { data, error } = await supabase
        .from("evaluations")
        .update({ moderation_status: status })
        .eq("id", evaluation.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        // Self-diagnosing: print both sides of the scope match so the
        // next click explains itself in the dev console.
        try {
          const mineQuery = supabase.from("admin_program_assignments").select("department_id");
          const [{ data: facRow }, { data: mine }, { data: depts }] = await Promise.all([
            supabase.from("users").select("id, full_name, department, department_id").eq("id", evaluation.faculty_id).maybeSingle(),
            currentUser ? mineQuery.eq("admin_id", currentUser.id) : mineQuery,
            supabase.from("departments").select("id, name"),
          ]);
          const deptName = (id) => depts?.find((d) => d.id === id)?.name || id;
          const diag = {
            evaluation: evaluation.id,
            faculty: facRow || "NOT VISIBLE (RLS hides this faculty row)",
            myAssignments: (mine || []).map((a) => deptName(a.department_id)),
          };
          console.log("[moderation-scope]", JSON.stringify(diag, null, 2));
          if (!facRow) {
            showNotice("No change saved — RLS hides the evaluated faculty row entirely (program-less or other program). Open console ([moderation-scope]) for details.", {
              type: "warning",
              title: "Program Scope Notice",
            });
          } else if (!facRow.department?.trim() && !facRow.department_id) {
            showNotice("No change saved — the evaluated faculty has no assigned program. Assign one in Faculty Management first.", {
              type: "warning",
              title: "Program Scope Notice",
            });
          } else {
            showNotice(`No change saved — faculty program (${facRow.department || facRow.department_id}) does not match your assignment (${diag.myAssignments.join(", ") || "none"}). Details in console.`, {
              type: "warning",
              title: "Program Scope Mismatch",
            });
          }
        } catch {
          const fac = faculty.find((f) => f.id === evaluation.faculty_id);
          showNotice(fac && !fac.department?.trim()
            ? "No change saved — the evaluated faculty has no assigned program. Assign one in Faculty Management first."
            : "No change saved — this comment belongs to a program outside your scope.", {
            type: "warning",
            title: "Program Scope Notice",
          });
        }
        return;
      }
      setEvaluations((prev) =>
        prev.map((e) => (e.id === evaluation.id ? { ...e, moderation_status: status } : e)),
      );
      logAdminAction("evaluation.moderate", "evaluations", evaluation.id, { moderation_status: status });
    } catch (err) {
      console.error("Failed to reclassify:", err);
      showNotice("Could not update the moderation status. Please try again.", {
        type: "error",
        title: "Update Failed",
      });
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
          showNotice("That word is already on the list.", {
            type: "warning",
            title: "Duplicate Word",
          });
          return;
        }
        throw error;
      }
      setWords((prev) => [...prev, data].sort((a, b) => a.word.localeCompare(b.word)));
      setNewWord("");
      logAdminAction("blocked_words.add", "blocked_words", data.id, { word, severity: newSeverity });
    } catch (err) {
      console.error("Failed to add word:", err);
      showNotice("Could not add the word. Please try again.", {
        type: "error",
        title: "Action Failed",
      });
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
      showNotice("Could not remove the word. Please try again.", {
        type: "error",
        title: "Action Failed",
      });
    }
  };

  // ---------- UI helpers (presentation only) ----------
  const STATUS_LABEL = { new: "New", acknowledged: "In Review", resolved: "Resolved", dismissed: "Dismissed" };
  const MOD_LABEL = { allow: "Allowed", flag: "Flagged", block: "Withheld" };
  const STATUS_ORDER = { new: 0, acknowledged: 1, resolved: 2, dismissed: 3 };

  const fmtDate = (v) =>
    v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

  const initials = (name) => {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "—";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const sourceLabel = (src) => {
    if (!src) return null;
    return String(src).toLowerCase().includes("ai") ? "AI auto-priority" : `Source: ${src}`;
  };

  const q = search.trim().toLowerCase();
  const matchesSearch = (evaluation) => {
    if (!q) return true;
    if (!evaluation) return false;
    return [
      facultyName(evaluation.faculty_id),
      facultyDept(evaluation.faculty_id),
      evaluation.original_comment,
      evaluation.academic_year,
      evaluation.semester,
    ].join(" ").toLowerCase().includes(q);
  };

  const newCount = reviews.filter((r) => r.status === "new").length;
  const ackCount = reviews.filter((r) => r.status === "acknowledged").length;
  const blockWords = words.filter((w) => w.severity === "block");
  const flagWords = words.filter((w) => w.severity !== "block");

  const visibleReviews = reviews
    .filter((r) => (statusFilter === "all" || r.status === statusFilter) && matchesSearch(evalById.get(r.evaluation_id)))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
  const visibleFlagged = flaggedEvals.filter(matchesSearch);

  const confirmDismiss = async (r) => {
    const ok = await showConfirm("Dismiss this priority case? It will be closed without a resolution.", {
      title: "Dismiss Case",
      confirmText: "Dismiss",
      type: "warning",
    });
    if (ok) updateReview(r, { status: "dismissed", resolution_note: "Dismissed by admin." });
  };

  const confirmWithhold = async (e) => {
    const ok = await showConfirm("Withhold this comment? It will stay hidden from the faculty member.", {
      title: "Withhold Comment",
      confirmText: "Withhold",
      type: "warning",
    });
    if (ok) setModeration(e, "block");
  };

  const submitResolve = async () => {
    if (!resolveTarget) return;
    const target = resolveTarget;
    await updateReview(target, {
      status: "resolved",
      resolution_note: resolveNote.trim() || "Reviewed and handled by admin.",
    });
    setResolveTarget(null);
    setResolveNote("");
  };

  const renderCaseHeader = (evaluation, chipLabel, chipColor, dateValue) => {
    const name = evaluation ? facultyName(evaluation.faculty_id) : "Unknown faculty";
    return (
      <div className="mod-caseTop">
        <div className="mod-caseWho">
          <div className="mod-avatar">{initials(name)}</div>
          <div className="mod-caseName">
            <strong>{name}</strong>
            {evaluation && <span className="mod-chip mod-chip--program">{facultyDept(evaluation.faculty_id)}</span>}
            {evaluation && (
              <span className="mod-casePeriod">{evaluation.academic_year} · {evaluation.semester}</span>
            )}
          </div>
        </div>
        <div className="mod-caseMeta">
          <span className="mod-status" style={{ color: chipColor, background: `${chipColor}18`, borderColor: `${chipColor}40` }}>
            {chipLabel}
          </span>
          {dateValue && <span className="mod-date">{fmtDate(dateValue)}</span>}
        </div>
      </div>
    );
  };

  const emptyState = (title, hint) => (
    <div className="mod-empty">
      <div className="mod-emptyIcon">✓</div>
      <div className="mod-emptyTitle">{title}</div>
      <div className="mod-emptyHint">{hint}</div>
    </div>
  );

  const searchBox = (
    <div className="ad-searchFilterWrap mod-search">
      <svg className="ad-searchFilterIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="text"
        className="ad-searchFilterInput"
        placeholder="Search faculty or comment..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
    </div>
  );

  return (
    <AdminLayout title="Moderation & Priority">
      <section className="ad-content">
        <div className="ad-welcomeHeader">
          <div>
            <h2 className="ad-title">Moderation &amp; Priority</h2>
            <p className="ad-subtitle">Review priority student concerns, flagged comments, and the blocked-words filter.</p>
          </div>
        </div>

        {/* KPI strip */}
        <div className="mod-kpiGrid">
          <div className="mod-kpi mod-kpi--red">
            <span className="mod-kpiIcon">!</span>
            <div><div className="mod-kpiLabel">Open Priority</div><div className="mod-kpiValue">{newCount}</div></div>
          </div>
          <div className="mod-kpi mod-kpi--amber">
            <span className="mod-kpiIcon">◔</span>
            <div><div className="mod-kpiLabel">In Review</div><div className="mod-kpiValue">{ackCount}</div></div>
          </div>
          <div className="mod-kpi mod-kpi--blue">
            <span className="mod-kpiIcon">⚑</span>
            <div><div className="mod-kpiLabel">Flagged to Review</div><div className="mod-kpiValue">{flaggedEvals.length}</div></div>
          </div>
          <div className="mod-kpi mod-kpi--gray">
            <span className="mod-kpiIcon">⦸</span>
            <div><div className="mod-kpiLabel">Blocked Words</div><div className="mod-kpiValue">{words.length}</div></div>
          </div>
        </div>

        {/* Tabs */}
        <div className="ad-tabs">
          {[
            { key: "priority", label: "Priority Queue", count: openReviews.length, hot: newCount > 0 },
            { key: "flagged", label: "Flagged Comments", count: flaggedEvals.length },
            { key: "words", label: "Blocked Words", count: words.length },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`ad-tab ${tab === t.key ? "ad-tab--active" : ""}`}
            >
              {t.label}
              <span className={`ad-tabBadge ${t.hot ? "mod-badgeHot" : ""}`}>{t.count}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="ad-tableCard" style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>
            Loading moderation data...
          </div>
        ) : (
          <>
            {/* PRIORITY QUEUE */}
            {tab === "priority" && (
              <div>
                <div className="mod-toolbar">
                  <div className="mod-pills">
                    {["all", "new", "acknowledged", "resolved", "dismissed"].map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`mod-pill ${statusFilter === s ? "mod-pill--active" : ""}`}
                        onClick={() => setStatusFilter(s)}
                      >
                        {s === "all" ? "All" : STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                  {searchBox}
                </div>

                {visibleReviews.length === 0 ? (
                  emptyState("No priority cases", reviews.length === 0 ? "Severe comments flagged by AI will appear here." : "No cases match your filters.")
                ) : (
                  <div className="mod-caseList">
                    {visibleReviews.map((r) => {
                      const evaluation = evalById.get(r.evaluation_id);
                      const color = STATUS_COLORS[r.status] || "#6b7280";
                      const src = sourceLabel(evaluation?.priority_source);
                      const open = r.status === "new" || r.status === "acknowledged";
                      return (
                        <div key={r.id} className="mod-case" style={{ borderLeftColor: color }}>
                          {renderCaseHeader(evaluation, STATUS_LABEL[r.status] || r.status, color, r.created_at)}
                          {evaluation ? (
                            evaluation.original_comment && (
                              <blockquote className="mod-quote">“{evaluation.original_comment}”</blockquote>
                            )
                          ) : (
                            <em style={{ color: "#9ca3af" }}>Evaluation not found</em>
                          )}
                          <div className="mod-caseBottom">
                            <div className="mod-caseTags">
                              {src && <span className="mod-chip mod-chip--source">{src}</span>}
                              {evaluation?.moderation_status && (
                                <span className="mod-chip" style={{ color: MOD_COLORS[evaluation.moderation_status], background: `${MOD_COLORS[evaluation.moderation_status]}15` }}>
                                  {MOD_LABEL[evaluation.moderation_status] || evaluation.moderation_status}
                                </span>
                              )}
                              {r.status === "resolved" && r.resolution_note && (
                                <span className="mod-note">Note: {r.resolution_note}</span>
                              )}
                            </div>
                            {open && (
                              <div className="mod-actions">
                                {r.status === "new" && (
                                  <button type="button" className="mod-btn mod-btn--outline" disabled={busyId === r.id} onClick={() => updateReview(r, { status: "acknowledged" })}>
                                    Acknowledge
                                  </button>
                                )}
                                <button type="button" className="mod-btn mod-btn--green" disabled={busyId === r.id} onClick={() => { setResolveTarget(r); setResolveNote(""); }}>
                                  Resolve
                                </button>
                                <button type="button" className="mod-btn mod-btn--danger" disabled={busyId === r.id} onClick={() => confirmDismiss(r)}>
                                  Dismiss
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* FLAGGED COMMENTS */}
            {tab === "flagged" && (
              <div>
                <div className="mod-toolbar">
                  <div className="mod-hint">Comments the filter marked for review. Allow to release them, or withhold to keep them hidden.</div>
                  {searchBox}
                </div>
                {visibleFlagged.length === 0 ? (
                  emptyState("Nothing to review", flaggedEvals.length === 0 ? "No flagged comments right now." : "No comments match your search.")
                ) : (
                  <div className="mod-caseList">
                    {visibleFlagged.map((e) => {
                      const unreviewed = e.moderation_labels?.unreviewed === true;
                      const color = MOD_COLORS[e.moderation_status] || "#d97706";
                      return (
                        <div key={e.id} className="mod-case" style={{ borderLeftColor: color }}>
                          {renderCaseHeader(e, MOD_LABEL[e.moderation_status] || e.moderation_status, color, e.submitted_on || e.created_at)}
                          {e.original_comment && <blockquote className="mod-quote">“{e.original_comment}”</blockquote>}
                          {unreviewed && (
                            <div className="mod-warn">⚠ Wordlist-only verdict (AI was unavailable) — please re-review.</div>
                          )}
                          <div className="mod-caseBottom">
                            <div className="mod-caseTags">
                              {sourceLabel(e.priority_source) && (
                                <span className="mod-chip mod-chip--source">{sourceLabel(e.priority_source)}</span>
                              )}
                            </div>
                            <div className="mod-actions">
                              <button type="button" className="mod-btn mod-btn--green" disabled={busyId === e.id} onClick={() => setModeration(e, "allow")}>
                                Allow
                              </button>
                              <button type="button" className="mod-btn mod-btn--danger" disabled={busyId === e.id} onClick={() => confirmWithhold(e)}>
                                Withhold
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* BLOCKED WORDS */}
            {tab === "words" && (
              <div className="mod-wordsGrid">
                <div className="ad-tableCard mod-card">
                  <h3 className="mod-cardTitle">Add Blocked Word</h3>
                  <input
                    type="text"
                    className="mod-input"
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addWord()}
                    placeholder="Add a word or phrase..."
                  />
                  <div className="mod-segment">
                    <button type="button" className={`mod-segBtn ${newSeverity === "flag" ? "mod-segBtn--flag" : ""}`} onClick={() => setNewSeverity("flag")}>
                      Flag (review)
                    </button>
                    <button type="button" className={`mod-segBtn ${newSeverity === "block" ? "mod-segBtn--block" : ""}`} onClick={() => setNewSeverity("block")}>
                      Block (reject)
                    </button>
                  </div>
                  <button
                    type="button"
                    className="ad-btnSearch"
                    onClick={addWord}
                    disabled={savingWord || !newWord.trim()}
                    style={{ opacity: savingWord || !newWord.trim() ? 0.6 : 1, width: "100%", marginTop: 4 }}
                  >
                    {savingWord ? "Adding..." : "Add Word"}
                  </button>
                  <div className="mod-info">
                    <p><strong>Block</strong> rejects the submission outright.</p>
                    <p><strong>Flag</strong> stores it for review in the Flagged Comments tab.</p>
                    <p>Legit criticism never matches these rules — the AI tier allows professional negative feedback.</p>
                  </div>
                </div>

                <div className="ad-tableCard mod-card">
                  <h3 className="mod-cardTitle">Word List</h3>
                  {words.length === 0 ? (
                    emptyState("No blocked words yet", "The AI classifier still runs on every comment.")
                  ) : (
                    <>
                      {[
                        { key: "block", label: "Block", list: blockWords, color: "#b91c1c", bg: "#fef2f2", border: "#fecaca" },
                        { key: "flag", label: "Flag", list: flagWords, color: "#92400e", bg: "#fffbeb", border: "#fde68a" },
                      ].map((g) => (
                        <div key={g.key} className="mod-wordGroup">
                          <div className="mod-wordGroupHead" style={{ color: g.color }}>
                            {g.label} · {g.list.length} word{g.list.length === 1 ? "" : "s"}
                          </div>
                          {g.list.length === 0 ? (
                            <div className="mod-wordNone">None</div>
                          ) : (
                            <div className="mod-wordChips">
                              {g.list.map((w) => (
                                <span key={w.id} className="mod-wordChip" style={{ color: g.color, background: g.bg, borderColor: g.border }}>
                                  {w.word}
                                  <button type="button" onClick={() => removeWord(w)} title="Remove" aria-label={`Remove ${w.word}`}>✕</button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* Resolve note modal */}
      {resolveTarget && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setResolveTarget(null)} />
          <div className="ad-modalContent" style={{ maxWidth: "480px" }}>
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle" style={{ fontSize: "16px" }}>Resolve Priority Case</h3>
              <button className="ad-modalClose" onClick={() => setResolveTarget(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="ad-modalBody">
              <label className="ad-label" style={{ fontSize: "12.5px" }}>Resolution note (optional)</label>
              <textarea
                className="mod-textarea"
                rows={4}
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                placeholder="Describe how this concern was handled..."
              />
            </div>
            <div className="ad-modalFooter">
              <button className="ad-btnSecondary" onClick={() => setResolveTarget(null)}>Cancel</button>
              <button className="ad-btnPrimary" onClick={submitResolve} disabled={busyId === resolveTarget.id}>Mark Resolved</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
