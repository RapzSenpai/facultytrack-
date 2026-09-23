// ============================================================
// FacultyTrack Edge Function: summarize-comments
// Phase 8 (Req 5 / Req 6 / D1) — on-demand AI summary of
// anonymized student comments for ONE teacher, PER SUBJECT,
// PER evaluation period. Every call is audit-logged; the model
// never receives any identity data.
//
// Who may call:
//   - faculty  — only for their OWN evaluations (their faculty_id)
//   - admin / super_admin — for anyone, but only periods that
//     have been RELEASED (admins may summarize anything visible
//     in admin_evaluations_anon; a period that is not yet
//     released has not been seen by the teacher, so summarizing
//     it for admin triage would still leak early — we gate on
//     is_period_released for fairness)
//
// Scope resolution (D1): faculty_id + subject_code + period.
// The caller passes faculty_id + academic_year + semester +
// subject_code (subject_code='' = all subjects of that period).
// The function re-resolves the scope from the DB; the client
// cannot widen it.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ------------------------------------------------------------
// Groq/OpenAI chat completion via the same candidate chain as
// submit-evaluation (safeguard -> gpt-oss-20b -> OpenAI).
// Returns raw content or null (AI unavailable).
// ------------------------------------------------------------
async function chatComplete(systemPrompt: string, userPrompt: string): Promise<string | null> {
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
  if (candidates.length === 0) return null;
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
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 900,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim().length > 0) return content;
    } catch (_err) {
      continue;
    }
  }
  return null;
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

    const admin = createClient(supabaseUrl, serviceKey);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized." }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => null);
    const facultyId = typeof body?.faculty_id === "string" ? body.faculty_id : "";
    const academicYear = typeof body?.academic_year === "string" ? body.academic_year : "";
    const semester = typeof body?.semester === "string" ? body.semester : "";
    // '' = all subjects within the period (faculty default view).
    const subjectCode = typeof body?.subject_code === "string" ? body.subject_code.trim() : "";

    if (!facultyId || !academicYear || !semester) {
      return json({ error: "faculty_id, academic_year and semester are required." }, 400);
    }

    // --------------------------------------------------------
    // Authorization from the profile table, never the body.
    // --------------------------------------------------------
    const { data: profile, error: profErr } = await admin
      .from("users")
      .select("role, status")
      .eq("id", userId)
      .single();
    if (profErr || !profile) return json({ error: "Profile not found." }, 403);

    const isFacultyCaller = profile.role === "faculty" && profile.status === "active";
    const isAdminCaller =
      (profile.role === "admin" || profile.role === "super_admin") &&
      profile.status === "active";

    if (!isFacultyCaller && !isAdminCaller) {
      return json({ error: "Forbidden." }, 403);
    }

    // Faculty may ONLY summarize their own evaluations.
    if (isFacultyCaller && facultyId !== userId) {
      return json({ error: "You can only summarize your own evaluations." }, 403);
    }

    // Program scope [D9]: a scoped admin may only summarize faculty
    // in their assigned program(s); super admin is global. Dual
    // match (department_id OR department name) mirrors export-report.
    let facultyDeptName: string | null = null;
    if (profile.role === "admin") {
      const [{ data: facultyRow }, { data: assignments }] = await Promise.all([
        admin
          .from("users")
          .select("department, department_id")
          .eq("id", facultyId)
          .eq("role", "faculty")
          .maybeSingle(),
        admin
          .from("admin_program_assignments")
          .select("department_id")
          .eq("admin_id", userId),
      ]);
      if (!facultyRow) {
        return json({ error: "Faculty not found." }, 404);
      }
      facultyDeptName = facultyRow.department ?? null;
      const assignedIds = (assignments ?? []).map((a: { department_id: string }) => a.department_id);
      if (assignedIds.length === 0) {
        return json({ error: "You have no program assignments." }, 403);
      }
      const inScopeById =
        facultyRow.department_id && assignedIds.includes(facultyRow.department_id);
      let inScopeByName = false;
      if (!inScopeById && facultyDeptName) {
        const { data: assignedDepts } = await admin
          .from("departments")
          .select("name")
          .in("id", assignedIds);
        inScopeByName = (assignedDepts ?? []).some(
          (d: { name: string }) => d.name === facultyDeptName,
        );
      }
      if (!inScopeById && !inScopeByName) {
        return json({ error: "That faculty member is outside your assigned program." }, 403);
      }
    } else if (profile.role === "super_admin") {
      const { data: facultyRow } = await admin
        .from("users")
        .select("department")
        .eq("id", facultyId)
        .maybeSingle();
      facultyDeptName = facultyRow?.department ?? null;
    }

    // --------------------------------------------------------
    // Load the scoped, identity-scrubbed comment set. Base-table
    // reads here are service-role, but the data selected is the
    // same shape the faculty/admin anon views expose — and we
    // enforce the extra rules the views cannot express per-call:
    //   - only moderation_status='allow' comments (flagged and
    //     blocked comments NEVER reach summaries — D6 spirit)
    //   - only released periods (admins too)
    //   - no student_id / student_token is ever selected
    // --------------------------------------------------------
    // Faculty callers summarize their own period: resolve their
    // program so a program-row release counts for them too.
    if (facultyDeptName === null && isFacultyCaller) {
      const { data: selfRow } = await admin
        .from("users")
        .select("department")
        .eq("id", userId)
        .maybeSingle();
      facultyDeptName = selfRow?.department ?? null;
    }

    const { data: releaseRows } = await admin
      .from("evaluation_releases")
      .select("academic_year, semester, department, approved, release_date")
      .eq("academic_year", academicYear)
      .eq("semester", semester);
    // Global row (department NULL) OR the faculty's program row.
    const released = (releaseRows ?? []).some(
      (r: { department: string | null; approved: boolean; release_date: string | null }) =>
        r.approved === true &&
        r.release_date !== null &&
        new Date(r.release_date) <= new Date() &&
        (r.department === null || r.department === facultyDeptName),
    );
    if (!released) {
      return json(
        { error: "Results for this period have not been released yet." },
        403,
      );
    }

    let query = admin
      .from("evaluations")
      .select("comment")
      .eq("faculty_id", facultyId)
      .eq("academic_year", academicYear)
      .eq("semester", semester)
      .eq("moderation_status", "allow")
      .not("comment", "is", null);
    if (subjectCode) {
      // Resolve the subject through the assignment so the summary
      // scope is exactly teacher + subject + period [D1].
      const { data: assignments } = await admin
        .from("class_assignments")
        .select("id")
        .eq("faculty_id", facultyId)
        .eq("academic_year", academicYear)
        .eq("semester", semester)
        .eq("subject_code", subjectCode);
      const ids = (assignments ?? []).map((a: { id: string }) => a.id);
      if (ids.length === 0) {
        return json({ error: "No assignments found for that subject in this period." }, 404);
      }
      query = query.in("assignment_id", ids);
    }

    const { data: rows, error: evalErr } = await query;
    if (evalErr) return json({ error: "Could not load comments." }, 500);

    const comments = (rows ?? [])
      .map((r: { comment: string | null }) => (r.comment ?? "").trim())
      .filter((c: string) => c.length > 0);

    if (comments.length === 0) {
      return json(
        { error: "No released, allowed comments exist for this scope yet." },
        404,
      );
    }

    // --------------------------------------------------------
    // Small-class caveat [D1]: tiny sample => weaker signal.
    // The caveat is returned with the summary and the UI shows it.
    // --------------------------------------------------------
    const smallSample = comments.length < 5;
    const caveat = smallSample
      ? `Only ${comments.length} comment(s) in this scope — treat these themes as indicative, not conclusive.`
      : null;

    // --------------------------------------------------------
    // The prompt hard-scrubs identity: comments are already
    // anonymized by the pipeline, but we re-affirm to the model
    // that no student identity exists in the text and none may be
    // inferred or fabricated in the output.
    // --------------------------------------------------------
    const systemPrompt = `You summarize anonymized student feedback about a university teacher.
The comments you receive contain no student identities. Never guess, infer, or invent any identity, name, gender, or student reference in your output.
Never mention ratings or numbers that were not provided.
Write plain text only (no markdown).`;

    const userPrompt = `Summarize the themes in the following student comments about the teacher for one subject in one evaluation period.
Structure your answer as short lines:
THEMES: 3-6 recurring themes, most frequent first.
STRENGTHS: 1-3 lines.
IMPROVEMENTS: 1-3 lines.
TONE: one short line (overall sentiment).
Keep it under 180 words. Professional, neutral wording.

Comments (${comments.length}):
${comments.map((c: string, i: number) => `${i + 1}. ${c.slice(0, 500)}`).join("\n")}`;

    const summaryText = await chatComplete(systemPrompt, userPrompt);
    if (!summaryText) {
      return json(
        {
          error:
            "AI summary is temporarily unavailable. Please try again later — raw anonymized comments remain available on the page.",
        },
        503,
      );
    }

    // --------------------------------------------------------
    // Audit log [Req 6]: every summary request is recorded.
    // No comment content goes into the audit row.
    // --------------------------------------------------------
    await admin.from("audit_log").insert({
      actor_id: userId,
      actor_role: profile.role,
      action: "ai.summary",
      entity: "evaluations",
      entity_id: facultyId,
      details: {
        faculty_id: facultyId,
        academic_year: academicYear,
        semester,
        subject_code: subjectCode || "(all subjects)",
        comment_count: comments.length,
        small_sample: smallSample,
      },
    });

    return json(
      {
        summary: summaryText.trim(),
        comment_count: comments.length,
        small_sample: smallSample,
        caveat,
        ai_generated: true,
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
