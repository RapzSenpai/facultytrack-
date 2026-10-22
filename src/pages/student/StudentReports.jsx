import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import { useStudentAssignments } from "../../hooks/useStudentAssignments";
import {
  Check,
  Clock,
  Info,
  AlertCircle,
  CheckCircle2,
  Send,
  FileText,
} from "lucide-react";
import StudentLayout from "./StudentLayout";

const ISSUE_CATEGORIES = [
  { id: "missing_subject", label: "Missing Subject", icon: "➕" },
  { id: "wrong_section", label: "Wrong Section", icon: "👥" },
  { id: "irregular", label: "Irregular Course", icon: "🔄" },
  { id: "duplicate", label: "Duplicate Subject", icon: "📑" },
  { id: "other", label: "Other", icon: "💬" },
];

export default function StudentReports() {
  // Phase 3 [Req 2 / D5]: in-app subject-list correction requests.
  const [reportTab, setReportTab] = useState("submit"); // "submit" | "history"
  const [reportCategory, setReportCategory] = useState("missing_subject");
  const [reportSubjectId, setReportSubjectId] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const [myRequests, setMyRequests] = useState([]);

  const { currentUser, userProfile } = useAuth();
  const { assignedFaculty } = useStudentAssignments(currentUser, userProfile);

  const dept = userProfile?.department || userProfile?.dept || "—";
  const yearLevel = userProfile?.yearLevel || userProfile?.year || "—";
  const section = userProfile?.section || "—";
  const displayName = userProfile?.fullName || "Student";

  const loadMyRequests = async () => {
    if (!currentUser) return;
    const { data } = await supabase
      .from("subject_correction_requests")
      .select("id, message, status, resolution_note, created_at")
      .eq("student_id", currentUser.id)
      .order("created_at", { ascending: false });
    setMyRequests(data || []);
  };

  useEffect(() => {
    loadMyRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const submitCorrectionRequest = async () => {
    const trimmed = reportMessage.trim();
    if (!trimmed) {
      setReportError("Please enter a description of the issue.");
      return;
    }
    if (trimmed.length < 10) {
      setReportError("Please provide a little more detail (at least 10 characters).");
      return;
    }

    setReportBusy(true);
    setReportError("");

    const categoryObj = ISSUE_CATEGORIES.find((c) => c.id === reportCategory) || ISSUE_CATEGORIES[0];
    const selectedSub = assignedFaculty.find((f) => f.assignmentId === reportSubjectId);
    const subDesc = selectedSub
      ? `${selectedSub.subjectCode || selectedSub.subjectName} (${selectedSub.name || "No faculty"})`
      : reportSubjectId === "not_listed"
      ? "Subject not listed"
      : "";

    const payloadMessage = `[${categoryObj.label}]${subDesc ? ` [${subDesc}]` : ""}: ${trimmed}`;

    try {
      const { error } = await supabase.from("subject_correction_requests").insert({
        student_id: currentUser.id,
        message: payloadMessage,
      });
      if (error) throw error;

      setReportMessage("");
      setReportSubjectId("");
      await loadMyRequests();
      setReportTab("history");

      // The database trigger sends the department-scoped admin notification.
    } catch (err) {
      setReportError(err.message || "Could not submit your request. Please try again.");
    } finally {
      setReportBusy(false);
    }
  };

  return (
    <StudentLayout breadcrumb="My Reports">
      <div className="sri-pageWrap">
        <div className="sri-modalCard sri-pageCard">
          <div className="sri-header">
            <div className="sri-headerTitleRow">
              <div className="sri-headerIconBadge">
                <FileText size={20} />
              </div>
              <div>
                <h3 className="sri-headerTitle">My Reports</h3>
              </div>
            </div>
          </div>

          <div className="sri-body">
            {/* Student Academic Profile Banner */}
            <div className="sri-profileBanner">
              <Info size={16} className="sri-profileBannerIcon" />
              <span>
                Enrolled as: <strong>{dept}</strong> · <strong>{yearLevel}</strong> · <strong>Section {section}</strong>
              </span>
            </div>

            {/* Segmented Tab Navigation */}
            <div className="sri-tabNav">
              <button
                type="button"
                className={`sri-tabBtn ${reportTab === "submit" ? "sri-tabBtn--active" : ""}`}
                onClick={() => setReportTab("submit")}
              >
                Submit Issue
              </button>
              <button
                type="button"
                className={`sri-tabBtn ${reportTab === "history" ? "sri-tabBtn--active" : ""}`}
                onClick={() => setReportTab("history")}
              >
                My Reports
                {myRequests.length > 0 && (
                  <span className="sri-tabBadge">{myRequests.length}</span>
                )}
              </button>
            </div>

            {reportTab === "submit" ? (
              <>
                {/* Category Chips */}
                <div>
                  <label className="sri-label">Select Issue Category</label>
                  <div className="sri-chipsGrid">
                    {ISSUE_CATEGORIES.map((cat) => {
                      const isSelected = reportCategory === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          className={`sri-chip ${isSelected ? "sri-chip--selected" : ""}`}
                          onClick={() => setReportCategory(cat.id)}
                        >
                          <span>{cat.icon}</span>
                          <span>{cat.label}</span>
                          {isSelected && <Check size={13} style={{ marginLeft: 2 }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Affected Subject Selector */}
                <div>
                  <label className="sri-label">Select Affected Subject (Optional)</label>
                  <select
                    className="sri-select"
                    value={reportSubjectId}
                    onChange={(e) => setReportSubjectId(e.target.value)}
                  >
                    <option value="">Choose a subject from your list…</option>
                    {assignedFaculty.map((f) => (
                      <option key={f.assignmentId} value={f.assignmentId}>
                        {f.subjectCode || f.subjectName} — {f.name || "No faculty assigned"}
                      </option>
                    ))}
                    <option value="not_listed">➕ Other / Subject missing from list</option>
                  </select>
                </div>

                {/* Issue Description Textarea */}
                <div className="sri-textareaWrap">
                  <label className="sri-label">Issue Details</label>
                  <textarea
                    className="sri-textarea"
                    value={reportMessage}
                    onChange={(e) => setReportMessage(e.target.value)}
                    maxLength={1000}
                    rows={4}
                    placeholder={
                      reportCategory === "missing_subject"
                        ? "State which subject code and instructor you are missing from your enrolled curriculum..."
                        : reportCategory === "wrong_section"
                        ? "Describe the section discrepancy (e.g. I am in Section A, but see Section B subjects)..."
                        : reportCategory === "irregular"
                        ? "Specify the irregular or retake subject you need added to your evaluation list..."
                        : "Describe the issue with your subject list in detail..."
                    }
                  />
                  <div className="sri-textareaFooter">
                    <span>Please be specific so your admin can resolve it promptly.</span>
                    <span className="sri-charCounter">{reportMessage.length} / 1000</span>
                  </div>
                </div>

                {reportError && (
                  <div className="sri-errorAlert">
                    <AlertCircle size={15} style={{ flexShrink: 0 }} />
                    <span>{reportError}</span>
                  </div>
                )}
              </>
            ) : (
              /* History Tab */
              <div className="sri-historyList">
                {myRequests.length === 0 ? (
                  <div className="sri-emptyHistory">
                    <Clock size={36} className="sri-emptyHistoryIcon" />
                    <p style={{ margin: 0, fontWeight: 600 }}>No reports submitted yet</p>
                    <p style={{ margin: "4px 0 0", fontSize: "12.5px" }}>
                      Any subject issue you submit will appear here with admin updates.
                    </p>
                  </div>
                ) : (
                  myRequests.map((r) => {
                    const isResolved = r.status === "resolved";
                    const isNew = r.status === "new";
                    return (
                      <div key={r.id} className="sri-reportCard">
                        <div className="sri-reportCardTop">
                          <span
                            className={`sri-statusBadge ${
                              isResolved
                                ? "sri-statusBadge--resolved"
                                : isNew
                                ? "sri-statusBadge--new"
                                : "sri-statusBadge--dismissed"
                            }`}
                          >
                            ● {isNew ? "Pending Review" : isResolved ? "Resolved" : "Dismissed"}
                          </span>
                          <span className="sri-reportDate">
                            {r.created_at
                              ? new Date(r.created_at).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })
                              : ""}
                          </span>
                        </div>

                        <p className="sri-reportMsg">{r.message}</p>

                        {r.resolution_note && (
                          <div className="sri-adminNoteCallout">
                            <CheckCircle2 size={15} className="sri-adminNoteIcon" />
                            <div>
                              <strong>Admin Note:</strong> {r.resolution_note}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div className="sri-footer">
            {reportTab === "submit" ? (
              <button
                type="button"
                className="sri-btnSubmit"
                onClick={submitCorrectionRequest}
                disabled={reportBusy}
              >
                <Send size={14} />
                {reportBusy ? "Submitting..." : "Submit Report"}
              </button>
            ) : (
              <button
                type="button"
                className="sri-btnSubmit"
                onClick={() => setReportTab("submit")}
              >
                New Report
              </button>
            )}
          </div>
        </div>
      </div>
    </StudentLayout>
  );
}
