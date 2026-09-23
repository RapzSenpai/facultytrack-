// ============================================================
// FacultyTrack Edge Function: export-report (Phase 7, Req 10 / D11 + D13)
// Statistics-only report export for Admin (program-scoped) and
// Super Admin.
//
// D13 contract (hard rules):
//   - NO comment text, NO AI summaries, NO student identity is
//     ever selected or returned. Only numbers + labels (counts,
//     averages, distributions, participation).
//   - Every export call is audit-logged.
//   - Caller must be an active admin (program-scoped via
//     admin_program_assignments [D9]) or super_admin.
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

function labelFor(rating: number): string {
  if (rating >= 4.5) return "Outstanding";
  if (rating >= 4.0) return "Excellent";
  if (rating >= 3.5) return "Very Good";
  if (rating >= 3.0) return "Good";
  return "Needs Improvement";
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

    // Caller must be an active admin or super_admin. Profile from
    // the table, never from the request body.
    const { data: profile, error: profErr } = await admin
      .from("users")
      .select("id, role, status, department")
      .eq("id", userId)
      .single();
    if (profErr || !profile) return json({ error: "Profile not found." }, 403);
    const isSuper = profile.role === "super_admin";
    if (profile.status !== "active" || (profile.role !== "admin" && !isSuper)) {
      return json({ error: "Forbidden." }, 403);
    }

    const body = await req.json().catch(() => null);
    const academicYear = typeof body?.academic_year === "string" ? body.academic_year : null;
    const semester = typeof body?.semester === "string" ? body.semester : null;
    if (!academicYear || !semester) {
      return json({ error: "academic_year and semester are required." }, 400);
    }

    // D9 scoping: resolve the caller's assigned programs. A scoped
    // admin with NO assignments gets NO data (strict D9).
    let assignedDeptIds: string[] = [];
    if (!isSuper) {
      const { data: assignments } = await admin
        .from("admin_program_assignments")
        .select("department_id")
        .eq("admin_id", userId);
      assignedDeptIds = (assignments ?? []).map((a) => a.department_id);
      if (assignedDeptIds.length === 0) {
        return json({ error: "No programs assigned to your account." }, 403);
      }
    }

    // Faculty rows (labels only: name + department). For a scoped
    // admin this also derives the in-scope faculty id list [D9].
    const { data: facultyRowsData, error: facErr } = await admin
      .from("users")
      .select("id, full_name, department, department_id")
      .eq("role", "faculty");
    if (facErr) return json({ error: "Could not load faculty." }, 500);
    const facultyRows = new Map((facultyRowsData ?? []).map((f) => [f.id, f]));

    let facultyFilter: string[] | null = null;
    if (!isSuper) {
      const { data: assignedDepts } = await admin
        .from("departments")
        .select("id, name")
        .in("id", assignedDeptIds);
      const names = (assignedDepts ?? []).map((d) => d.name);
      facultyFilter = (facultyRowsData ?? [])
        .filter(
          (f) =>
            (f.department_id && assignedDeptIds.includes(f.department_id)) ||
            names.includes(f.department),
        )
        .map((f) => f.id);
    }

    // Ratings for the period. Only: faculty_id, assignment_id,
    // ratings, submitted_at. comment/student_id are NEVER selected.
    let ratingsQuery = admin
      .from("evaluations")
      .select("faculty_id, assignment_id, ratings, submitted_at")
      .eq("academic_year", academicYear)
      .eq("semester", semester);
    if (facultyFilter) {
      if (facultyFilter.length === 0) {
        return json({ report: { faculties: [], summary: { forms: 0 } }, generated_at: new Date().toISOString() }, 200);
      }
      ratingsQuery = ratingsQuery.in("faculty_id", facultyFilter);
    }
    const { data: evals, error: evalErr } = await ratingsQuery;
    if (evalErr) return json({ error: "Could not load evaluation data." }, 500);

    // Assignments give subject/program labels for grouping.
    const { data: assignments, error: assignErr } = await admin
      .from("class_assignments")
      .select("id, faculty_id, subject_code, subject_name, department, year_level, section");
    if (assignErr) return json({ error: "Could not load assignments." }, 500);
    const assignmentById = new Map((assignments ?? []).map((a) => [a.id, a]));

    // Aggregate per faculty (stats only).
    const perFaculty = new Map<string, { scores: number[]; forms: number; subjects: Set<string> }>();
    let formCount = 0;
    for (const e of evals ?? []) {
      formCount++;
      const vals = Object.values(e.ratings ?? {}).map(Number).filter((n) => !isNaN(n));
      let entry = perFaculty.get(e.faculty_id);
      if (!entry) {
        entry = { scores: [], forms: 0, subjects: new Set() };
        perFaculty.set(e.faculty_id, entry);
      }
      entry.forms++;
      entry.scores.push(...vals);
      const a = assignmentById.get(e.assignment_id);
      if (a) entry.subjects.add(`${a.subject_code} (${a.department})`);
    }

    const faculties = [...perFaculty.entries()].map(([fid, agg]) => {
      const avg = agg.scores.length
        ? agg.scores.reduce((x, y) => x + y, 0) / agg.scores.length
        : null;
      // Distribution of the 1-5 ratings for this faculty.
      const distribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
      for (const s of agg.scores) {
        const k = String(Math.round(s));
        if (distribution[k] !== undefined) distribution[k]++;
      }
      const fRow = facultyRows.get(fid);
      return {
        faculty_id: fid,
        faculty_name: fRow?.full_name ?? "Unknown",
        department: fRow?.department ?? null,
        forms_received: agg.forms,
        subjects: [...agg.subjects],
        average_rating: avg === null ? null : Number(avg.toFixed(2)),
        performance_label: avg === null ? null : labelFor(avg),
        rating_distribution: distribution,
      };
    }).sort((a, b) => (b.average_rating ?? 0) - (a.average_rating ?? 0));

    // Global summary stats.
    const allScores = faculties.flatMap((f) =>
      Object.entries(f.rating_distribution).flatMap(([k, n]) => Array(Number(n)).fill(Number(k))),
    );
    const summary = {
      academic_year: academicYear,
      semester,
      forms_total: formCount,
      faculty_evaluated: faculties.length,
      overall_average: allScores.length
        ? Number((allScores.reduce((x, y) => x + y, 0) / allScores.length).toFixed(2))
        : null,
    };

    // Audit-log the export [D11 contract].
    await admin.from("audit_log").insert({
      actor_id: userId,
      actor_role: isSuper ? "super_admin" : "admin",
      action: "report.export",
      entity: "evaluations",
      entity_id: `${academicYear}:${semester}`,
      details: { faculty_count: faculties.length, forms: formCount, scoped: !isSuper },
    });

    return json(
      {
        report: { summary, faculties },
        generated_at: new Date().toISOString(),
        note: "Statistics only. Comments, AI summaries and identities are excluded by design (D13).",
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
