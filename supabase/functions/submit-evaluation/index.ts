// ============================================================
// FacultyTrack Edge Function: submit-evaluation
// Blueprint v3 §5.1 — the ONLY write path for evaluations.
// Validates: authenticated active student, active period
// (on-going + within end date), assignment in the student's
// authorized list, no duplicate submission.
// Phase 3 authorized list (Req 2 / D5): the student's section
// match UNION their legacy confirmed enrollment MINUS admin
// exclusions. With admin/exception enrollment kinds the row
// fully governs (match − excluded). Students no longer write
// enrollments themselves (migration 008 §5.5).
// Phase 6 moderation (Req 3): tier-1 admin wordlist, tier-2 AI
// classifier (OpenAI, key in Edge Function secrets — never in
// VITE_*). allow/flag/block; AI down => wordlist-only verdict +
// unreviewed backlog note. High severity auto-priority (Req 8).
// Student can mark the evaluation Priority [Req 8] (rate-limited).
// Records an audit_log entry for every submission.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Student Priority rate limit [REC]: max 3 per student per period.
const MAX_PRIORITY_PER_PERIOD = 3;

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Mirror of the client-side matching logic in
// StudentEvaluation.jsx / StudentDashboard.jsx so the server-side
// authorized-list check behaves identically to today's UI flow.
// Field-specific normalizers (year -> digit, section strips the
// word "section") match the client exactly; generic substring
// matching is NOT used (section "1" must not match "10A).
function normalize(s: unknown): string {
  return (s ?? "").toString().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeYear(y: unknown): string {
  if (!y) return "";
  const str = normalize(y);
  if (str.includes("1") || str.includes("first")) return "1";
  if (str.includes("2") || str.includes("second")) return "2";
  if (str.includes("3") || str.includes("third")) return "3";
  if (str.includes("4") || str.includes("fourth")) return "4";
  return str;
}

function normalizeSection(s: unknown): string {
  if (!s) return "";
  return s.toString().toLowerCase().replace(/section/g, "").replace(/[^a-z0-9]/g, "");
}

function isMatch(a: unknown, b: unknown): boolean {
  if (!a || !b) return false;
  const n1 = normalize(a);
  const n2 = normalize(b);
  // Exact normalized equality only: substring matching (e.g. section
  // "1" matching "10A") over-authorizes subjects. Genuine mismatches
  // go through the in-app correction-request flow instead.
  return n1 !== "" && n1 === n2;
}

function isFieldMatch(kind: "dept" | "year" | "section", a: unknown, b: unknown): boolean {
  if (!a || !b) return false;
  const n1 = kind === "year" ? normalizeYear(a) : kind === "section" ? normalizeSection(a) : normalize(a);
  const n2 = kind === "year" ? normalizeYear(b) : kind === "section" ? normalizeSection(b) : normalize(b);
  return n1 !== "" && n1 === n2;
}

// ------------------------------------------------------------
// Tier 1: wordlist. Whole-word, case-insensitive substring match
// against blocked_words. 'block' beats 'flag'.
// ------------------------------------------------------------
function wordlistVerdict(
  text: string,
  words: { word: string; severity: string }[],
): { status: "allow" | "flag" | "block"; labels: string[] } {
  const lower = text.toLowerCase();
  const labels: string[] = [];
  let status: "allow" | "flag" | "block" = "allow";
  for (const { word, severity } of words) {
    const w = word.toLowerCase().trim();
    if (!w) continue;
    const pattern = new RegExp(
      `(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`,
      "i",
    );
    if (pattern.test(lower)) {
      labels.push(`${severity}:${w}`);
      if (severity === "block") status = "block";
      else if (status === "allow") status = "flag";
    }
  }
  return { status, labels };
}

// ------------------------------------------------------------
// Tier 2: AI classifier. Only runs when wordlist says allow/flag.
// Returns allow/flag/block + severity + normalized labels.
// NEVER blocks legit criticism: the prompt demands allow for
// professional negative feedback; 'block' only for genuine
// profanity/harassment/threats. Any API/parse failure degrades
// to the wordlist verdict (availability over perfection).
// Provider: GROQ_API_KEY (OpenAI-compatible endpoint, Llama models)
// first, OPENAI_API_KEY fallback — keys live ONLY in function
// secrets, never in VITE_*.
// ------------------------------------------------------------
type AiVerdict = {
  status: "allow" | "flag" | "block";
  severity: "low" | "medium" | "high";
  labels: string[];
  aiAvailable: boolean;
};

async function aiClassify(text: string): Promise<AiVerdict | null> {
  // Candidate chain, first success wins. llama-3.1-8b-instant was
  // deprecated by Groq (announced June 2026); the current text
  // models there are OpenAI's open-weight gpt-oss family, and
  // gpt-oss-safeguard-20b is a purpose-built safety classifier —
  // ideal for this job. Live-tested: returns clean JSON with
  // reasoning kept in a separate field our parser ignores.
  const candidates: { url: string; key: string; model: string }[] = [];
  const groqKey = Deno.env.get("GROQ_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (groqKey) {
    candidates.push(
      { url: "https://api.groq.com/openai/v1/chat/completions", key: groqKey, model: "openai/gpt-oss-safeguard-20b" },
      { url: "https://api.groq.com/openai/v1/chat/completions", key: groqKey, model: "openai/gpt-oss-20b" },
    );
  }
  if (openaiKey) {
    candidates.push(
      { url: "https://api.openai.com/v1/chat/completions", key: openaiKey, model: "gpt-4o-mini" },
    );
  }
  if (candidates.length === 0) return null; // not configured -> wordlist-only
  const prompt = `You are a content moderator for university teacher evaluations.
Decide if this student comment is acceptable to show to the teacher.

Rules:
- "allow": any professional criticism, complaint, or negative feedback about teaching. This MUST be allowed.
- "flag": borderline rudeness, sarcasm, mild insults, personal remarks that are not profanity.
- "block": genuine profanity, slurs, sexual content, threats, or harassment.

Reply ONLY with compact JSON:
{"status":"allow|flag|block","severity":"low|medium|high","labels":["<short label>", ...]}

Comment:
"""
${text.slice(0, 2000)}
"""`;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${candidate.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: candidate.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 512,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") continue;
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) continue;
      const parsed = JSON.parse(match[0]);
      const status = ["allow", "flag", "block"].includes(parsed.status)
        ? parsed.status
        : null;
      const severity = ["low", "medium", "high"].includes(parsed.severity)
        ? parsed.severity
        : "low";
      if (!status) continue;
      return {
        status,
        severity,
        labels: Array.isArray(parsed.labels)
          ? parsed.labels.filter((l: unknown) => typeof l === "string").slice(0, 5)
          : [],
        aiAvailable: true,
      };
    } catch (_err) {
      continue; // model/endpoint failed — try the next candidate
    }
  }
  return null; // every candidate failed -> wordlist-only verdict
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header." }, 401);

    // Service client: bypasses RLS for validation reads + insert.
    const admin = createClient(supabaseUrl, serviceKey);
    // User client: resolves the caller from their JWT.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Unauthorized." }, 401);
    }
    const userId = userData.user.id;

    // Caller must be an active student. Role/status come from the
    // profile table, never from the request body.
    const { data: profile, error: profErr } = await admin
      .from("users")
      .select("id, role, status, department, year_level, section")
      .eq("id", userId)
      .single();
    if (profErr || !profile) {
      return json({ error: "Profile not found." }, 403);
    }
    if (profile.role !== "student" || profile.status !== "active") {
      return json({ error: "Forbidden." }, 403);
    }

    const body = await req.json().catch(() => null);
    const assignmentId = body?.assignment_id;
    const ratings = body?.ratings;
    const comment = typeof body?.comment === "string" ? body.comment : "";
    const priority = body?.priority === true;

    if (typeof assignmentId !== "string" || assignmentId.length === 0) {
      return json({ error: "assignment_id is required." }, 400);
    }
    if (
      !ratings ||
      typeof ratings !== "object" ||
      Array.isArray(ratings) ||
      Object.keys(ratings).length === 0
    ) {
      return json({ error: "ratings are required." }, 400);
    }
    for (const value of Object.values(ratings)) {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        return json({ error: "Each rating must be an integer from 1 to 5." }, 400);
      }
    }
    // Rating keys must be real question ids — arbitrary keys would
    // pollute per-criteria aggregates downstream. Fail-open when no
    // questionnaire is configured yet: the client falls back to its
    // built-in criteria set (FALLBACK_CRITERIA) in that state.
    const { data: questionRows, error: qErr } = await admin
      .from("questions")
      .select("id");
    if (qErr) return json({ error: "Could not validate the questionnaire." }, 500);
    if ((questionRows ?? []).length > 0) {
      const validIds = new Set((questionRows ?? []).map((q: { id: string }) => q.id));
      for (const key of Object.keys(ratings)) {
        if (!validIds.has(key)) {
          return json({ error: "Unknown question in ratings." }, 400);
        }
      }
    }

    // Active period: on-going row, and inside its end date.
    const { data: years, error: yearsErr } = await admin
      .from("academic_years")
      .select("year, semester, status, start_date, end_date");
    if (yearsErr) return json({ error: "Could not load academic periods." }, 500);
    const active = (years ?? []).find(
      (y: { status?: string }) => (y.status ?? "").toLowerCase().trim() === "on-going",
    );
    if (!active) {
      return json({ error: "No active evaluation period is available." }, 400);
    }
    if (active.end_date) {
      const end = new Date(`${active.end_date}T23:59:59Z`);
      if (Number.isNaN(end.getTime())) {
        return json({ error: "Active period has an invalid end date." }, 500);
      }
      if (new Date() > end) {
        return json({ error: "The evaluation period is closed." }, 400);
      }
    }

    // Assignment must exist and belong to the active period.
    const { data: assignment, error: assignErr } = await admin
      .from("class_assignments")
      .select("id, faculty_id, department, year_level, section, academic_year, semester")
      .eq("id", assignmentId)
      .single();
    if (assignErr || !assignment) {
      return json({ error: "Subject assignment not found." }, 404);
    }
    if (
      assignment.academic_year !== active.year ||
      assignment.semester !== active.semester
    ) {
      return json(
        { error: "This subject is not part of the active evaluation period." },
        400,
      );
    }

    // Authorized list (Phase 3): section match ∪ legacy confirmed
    // enrollments − admin exclusions. An admin/exception row
    // governs fully (match − excluded), so a re-sectioned student
    // with an explicit list loses the old section's subjects.
    const { data: enrollment } = await admin
      .from("student_enrollments")
      .select("confirmed_assignments, excluded_assignments, enrollment_kind")
      .eq("student_id", userId)
      .eq("academic_year", active.year)
      .eq("semester", active.semester)
      .maybeSingle();

    const selfMatched =
      isFieldMatch("dept", assignment.department, profile.department) &&
      isFieldMatch("year", assignment.year_level, profile.year_level) &&
      isFieldMatch("section", assignment.section, profile.section);

    const confirmed = enrollment?.confirmed_assignments;
    const excluded = enrollment?.excluded_assignments;
    const isAdminList =
      enrollment?.enrollment_kind === "admin" ||
      enrollment?.enrollment_kind === "exception";

    const excludedHere =
      Array.isArray(excluded) && excluded.includes(assignmentId);
    const confirmedHere =
      Array.isArray(confirmed) && confirmed.includes(assignmentId);

    const authorized = excludedHere
      ? false
      : isAdminList
        ? confirmedHere
        : confirmedHere || selfMatched;

    if (!authorized) {
      return json({ error: "You are not assigned to this subject." }, 403);
    }

    // Duplicate submission guard (DB UNIQUE also enforces this).
    const { data: existing } = await admin
      .from("evaluations")
      .select("id")
      .eq("student_id", userId)
      .eq("assignment_id", assignmentId)
      .maybeSingle();
    if (existing) {
      return json({ error: "You have already evaluated this subject." }, 409);
    }

    // --------------------------------------------------------
    // Phase 6: Priority rate limit [REC] — max 3 per period.
    // Counts only THIS student's priority rows in the period;
    // service-role read, no identity exposure anywhere.
    // --------------------------------------------------------
    if (priority) {
      const { count } = await admin
        .from("evaluations")
        .select("id", { count: "exact", head: true })
        .eq("student_id", userId)
        .eq("academic_year", active.year)
        .eq("semester", active.semester)
        .eq("is_priority", true);
      if ((count ?? 0) >= MAX_PRIORITY_PER_PERIOD) {
        return json(
          { error: "You have reached the priority limit for this period." },
          429,
        );
      }
    }

    // --------------------------------------------------------
    // Phase 6 moderation pipeline (Req 3).
    // --------------------------------------------------------
    let moderationStatus: "allow" | "flag" | "block" = "allow";
    let moderationLabels: Record<string, unknown> = {};
    let autoPriority = false;

    if (comment.trim().length > 0) {
      // Tier 1: admin wordlist.
      const { data: words } = await admin
        .from("blocked_words")
        .select("word, severity");
      const t1 = wordlistVerdict(comment, words ?? []);

      // Tier 2: AI classifier (skipped when tier-1 already blocked).
      const t2 = t1.status === "block" ? null : await aiClassify(comment);

      if (t2) {
        // AI verdict participates; block wins, then flag.
        if (t2.status === "block" || t1.status === "block") {
          moderationStatus = "block";
        } else if (t2.status === "flag" || t1.status === "flag") {
          moderationStatus = "flag";
        }
        autoPriority = t2.severity === "high";
        moderationLabels = {
          tier1: t1.labels,
          tier2: { status: t2.status, severity: t2.severity, labels: t2.labels },
        };
      } else {
        // AI unavailable (not configured, down, or unparseable):
        // wordlist-only verdict. A tier-1 flag is marked unreviewed
        // so admins can re-scan the backlog when AI returns.
        moderationStatus = t1.status;
        moderationLabels =
          t1.status === "allow" ? {} : { tier1: t1.labels, unreviewed: true };
      }
    }

    if (moderationStatus === "block") {
      return json(
        {
          error:
            "Your comment was blocked by content moderation. Please remove offensive language and try again. Legit criticism is always welcome.",
        },
        422,
      );
    }

    const isPriority = priority || autoPriority;
    const prioritySource = priority ? "student" : autoPriority ? "ai" : null;

    // Blocked submissions never reach the insert (422 above); this
    // mask is defence-in depth in case that flow changes later.
    const storedComment =
      moderationStatus === "block" ? "[comment withheld by moderation]" : comment;

    const { data: inserted, error: insertErr } = await admin
      .from("evaluations")
      .insert({
        student_id: userId,
        faculty_id: assignment.faculty_id,
        assignment_id: assignmentId,
        academic_year: active.year,
        semester: active.semester,
        ratings,
        comment: storedComment,
        submitted_at: new Date().toISOString(),
        moderation_status: moderationStatus,
        moderation_labels: moderationLabels,
        original_comment: comment.trim().length > 0 ? comment : null,
        is_priority: isPriority,
        priority_source: prioritySource,
      })
      .select("id, submitted_at, moderation_status")
      .single();

    if (insertErr) {
      if (insertErr.code === "23505") {
        return json({ error: "You have already evaluated this subject." }, 409);
      }
      return json({ error: "Could not save the evaluation." }, 500);
    }

    // Priority queue row [D7] — one per evaluation (unique index).
    if (isPriority) {
      await admin.from("priority_reviews").insert({
        evaluation_id: inserted.id,
        source: prioritySource,
        status: "new",
      });
    }

    await admin.from("audit_log").insert({
      actor_id: userId,
      actor_role: "student",
      action: "evaluation.submit",
      entity: "evaluations",
      entity_id: inserted.id,
      details: {
        assignment_id: assignmentId,
        faculty_id: assignment.faculty_id,
        academic_year: active.year,
        semester: active.semester,
        comment_included: comment.trim().length > 0,
        moderation_status: moderationStatus,
        priority: isPriority,
        priority_source: prioritySource,
      },
    });

    return json(
      {
        evaluation: {
          id: inserted.id,
          submitted_at: inserted.submitted_at,
          moderation_status: inserted.moderation_status,
        },
      },
      200,
    );
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Unexpected error." },
      500,
    );
  }
});
