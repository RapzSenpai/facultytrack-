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
// Moderation: STUBBED to allow (Phase 6 replaces this).
// Records an audit_log entry for every submission.
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

// Mirror of the client-side matching logic in
// StudentEvaluation.jsx / StudentDashboard.jsx so the server-side
// authorized-list check behaves identically to today's UI flow.
function normalize(s: unknown): string {
  return (s ?? "").toString().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isMatch(a: unknown, b: unknown): boolean {
  if (!a || !b) return false;
  const n1 = normalize(a);
  const n2 = normalize(b);
  return n1 === n2 || n1.includes(n2) || n2.includes(n1);
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
      isMatch(assignment.department, profile.department) &&
      isMatch(assignment.year_level, profile.year_level) &&
      isMatch(assignment.section, profile.section);

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

    // Moderation (Phase 6): currently a stub — every comment is
    // allowed and nothing is stored yet. Do not extend here.
    const moderationStatus = "allow";

    const { data: inserted, error: insertErr } = await admin
      .from("evaluations")
      .insert({
        student_id: userId,
        faculty_id: assignment.faculty_id,
        assignment_id: assignmentId,
        academic_year: active.year,
        semester: active.semester,
        ratings,
        comment,
        submitted_at: new Date().toISOString(),
      })
      .select("id, submitted_at")
      .single();

    if (insertErr) {
      if (insertErr.code === "23505") {
        return json({ error: "You have already evaluated this subject." }, 409);
      }
      return json({ error: "Could not save the evaluation." }, 500);
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
      },
    });

    return json({ evaluation: inserted }, 200);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Unexpected error." },
      500,
    );
  }
});
