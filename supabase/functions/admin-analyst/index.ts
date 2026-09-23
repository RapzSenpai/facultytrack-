// ============================================================
// FacultyTrack Edge Function: admin-analyst
// Phase 8 (Req 4 / Req 6 / D9 / D11-adjacent) — the admin AI
// chatbox. The model NEVER touches the database. Instead, this
// function computes a FIXED, pre-authorized aggregate digest
// server-side and the model may only reason over those numbers:
//
//   1. program_averages    — avg rating per program (released periods)
//   2. lowest_rated        — bottom faculty by avg (names OK — faculty
//                            are not anonymous; students are)
//   3. weak_criteria       — lowest-rated criteria categories
//   4. moderation_counts   — flagged / priority / queue statuses
//   5. participation_gaps  — classes without any evaluation, per program
//   6. trends              — per-period averages (released only)
//
// Hard guarantees:
//   - NO student identity is ever selected (no student_id, no
//     student_token, no comments) — the model cannot leak what
//     it never receives.
//   - Scope [D9]: admins are restricted to their assigned
//     programs (admin_assigned_department_ids); an admin with no
//     assignments gets 403; super_admin sees all programs.
//   - Only RELEASED periods feed ratings analytics (§4.7 rule).
//   - Every call is audit-logged (question + answer + scope).
//   - Soft rate limit: 30 questions per caller per hour.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RATE_LIMIT_PER_HOUR = 30;

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function fetchAllPaginated<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await fetchPage(offset, pageSize);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return out;
}

async function chatComplete(digest: unknown, question: string): Promise<string | null> {
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

  const systemPrompt = `You are the FacultyTrack evaluation analyst for a college.
You answer questions about faculty evaluation data for authorized administrators.

STRICT RULES:
1. You may ONLY use the numbers and names in the JSON digest provided. You have no other data source.
2. If the digest cannot answer the question, say exactly that — never invent numbers, names, or trends.
3. Never mention, guess, or fabricate any student identity. Student identity does not exist in your data.
4. Comments and AI summaries are NOT part of the digest — if asked about comment content, say summaries are a separate feature and you only have aggregate numbers.
5. Average ratings use the 1-5 scale. "Forms" = submitted evaluation forms.
6. Be concise and concrete: cite the exact numbers you used.
7. Plain text only (no markdown tables). Keep answers under 250 words.`;

  const userPrompt = `DATA DIGEST (your only data source):
${JSON.stringify(digest)}

QUESTION:
${question.slice(0, 1000)}`;

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
          temperature: 0.1,
          max_tokens: 900,
        }),
        signal: AbortSignal.timeout(25_000),
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

// ------------------------------------------------------------
// Digest builders — every query here is aggregate-only and
// scoped. Released-period gating uses the same rule as the DB
// (approved AND release_date passed).
// ------------------------------------------------------------
function isReleased(
  releases: { academic_year: string; semester: string; department: string | null; approved: boolean; release_date: string | null }[],
  year: string,
  semester: string,
  deptName: string | null,
): boolean {
  return releases.some(
    (r) =>
      r.academic_year === year &&
      r.semester === semester &&
      r.approved === true &&
      r.release_date !== null &&
      new Date(r.release_date) <= new Date() &&
      (r.department === null || r.department === deptName),
  );
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
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question) return json({ error: "question is required." }, 400);
    if (question.length > 1000) return json({ error: "Question is too long." }, 400);

    // Caller must be an active admin or super admin.
    const { data: profile, error: profErr } = await admin
      .from("users")
      .select("role, status")
      .eq("id", userId)
      .single();
    if (profErr || !profile) return json({ error: "Profile not found." }, 403);
    if (
      !["admin", "super_admin"].includes(profile.role) ||
      profile.status !== "active"
    ) {
      return json({ error: "Forbidden." }, 403);
    }

    // Soft rate limit (audit-log based — survives instance restarts).
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await admin
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("actor_id", userId)
      .eq("action", "ai.analyst")
      .gte("created_at", hourAgo);
    if ((recentCount ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return json(
        { error: "AI analyst rate limit reached (30 questions/hour). Try again later." },
        429,
      );
    }

    // --------------------------------------------------------
    // Scope [D9]: admins see only their assigned programs'
    // data; super admin sees everything; unassigned admin 403.
    // --------------------------------------------------------
    const isSuper = profile.role === "super_admin";
    let assignedDeptIds: string[] = [];
    if (!isSuper) {
      const { data: assignments } = await admin
        .from("admin_program_assignments")
        .select("department_id")
        .eq("admin_id", userId);
      assignedDeptIds = (assignments ?? []).map((a: { department_id: string }) => a.department_id);
      if (assignedDeptIds.length === 0) {
        return json(
          { error: "You have no program assignments, so there is no data to analyze." },
          403,
        );
      }
    }

    // Reference data. Batch fetch to avoid unbounded, unpaginated reads
    // while still gathering every matching record within scope.
    const [deptRes, criteriaRes, questionsRes] = await Promise.all([
      admin.from("departments").select("id, name"),
      admin.from("criteria").select("id, name"),
      admin.from("questions").select("id, criteria_id"),
    ]);

    const departments = deptRes.data ?? [];
    const criteriaRows = criteriaRes.data ?? [];
    const questionsRows = questionsRes.data ?? [];
    const facultyRows = await fetchAllPaginated<{ id: string; full_name: string; department: string | null; department_id: string | null }>(
      async (offset, limit) => admin
        .from("users")
        .select("id, full_name, department, department_id")
        .eq("role", "faculty")
        .range(offset, offset + limit - 1),
    );
    const assignments = await fetchAllPaginated<{ id: string; faculty_id: string; department: string; academic_year: string; semester: string }>(
      async (offset, limit) => admin
        .from("class_assignments")
        .select("id, faculty_id, department, academic_year, semester")
        .range(offset, offset + limit - 1),
    );

    const deptName = (id: string | null) =>
      departments.find((d: { id: string }) => d.id === id)?.name ?? null;
    const facultyName = (id: string) =>
      facultyRows.find((f: { id: string }) => f.id === id)?.full_name ?? "Unknown faculty";
    const facultyDeptId = (id: string) =>
      facultyRows.find((f: { id: string }) => f.id === id)?.department_id ?? null;
    const facultyDeptName = (id: string): string | null =>
      facultyRows.find((f: { id: string }) => f.id === id)?.department ?? null;

    const assignedDeptNames = isSuper
      ? []
      : departments
        .filter((d: { id: string }) => assignedDeptIds.includes(d.id))
        .map((d: { name: string }) => d.name);
    const visibleFacultyIds = new Set(
      isSuper
        ? facultyRows.map((f: { id: string }) => f.id)
        : facultyRows
          .filter((f: { department_id: string | null; department: string }) =>
            (f.department_id && assignedDeptIds.includes(f.department_id)) ||
            assignedDeptNames.includes(f.department),
          )
          .map((f: { id: string }) => f.id),
    );
    const visibleAssignments = assignments.filter((a: { faculty_id: string }) =>
      visibleFacultyIds.has(a.faculty_id),
    );

    // Releases + evaluations (aggregate fields only — no comment,
    // no student_id ever selected).
    const releases = await fetchAllPaginated<{ academic_year: string; semester: string; department: string | null; approved: boolean; release_date: string | null }>(
      async (offset, limit) => admin
        .from("evaluation_releases")
        .select("academic_year, semester, department, approved, release_date")
        .range(offset, offset + limit - 1),
    );
    const evaluations = (await fetchAllPaginated<{ faculty_id: string; assignment_id: string; academic_year: string; semester: string; ratings: Record<string, number> | null; is_priority: boolean; priority_source: string | null; moderation_status: string }>(
      async (offset, limit) => admin
        .from("evaluations")
        .select("faculty_id, assignment_id, academic_year, semester, ratings, is_priority, priority_source, moderation_status")
        .range(offset, offset + limit - 1),
    )).filter((e: { faculty_id: string }) => visibleFacultyIds.has(e.faculty_id));

    const releasedEvals = evaluations.filter((e: { faculty_id: string; academic_year: string; semester: string }) =>
      isReleased(releases, e.academic_year, e.semester, facultyDeptName(e.faculty_id)),
    );

    const overallOf = (ratings: Record<string, number> | null): number | null => {
      if (!ratings) return null;
      const vals = Object.values(ratings).map(Number).filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
      if (vals.length === 0) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    // ---- 1. Program averages (released periods only) ----
    const byProgram: Record<string, { sum: number; n: number }> = {};
    releasedEvals.forEach((e: { faculty_id: string; ratings: Record<string, number> | null }) => {
      const dId = facultyDeptId(e.faculty_id);
      if (!dId) return;
      const overall = overallOf(e.ratings);
      if (overall === null) return;
      byProgram[dId] = byProgram[dId] ?? { sum: 0, n: 0 };
      byProgram[dId].sum += overall;
      byProgram[dId].n += 1;
    });
    const programAverages = Object.entries(byProgram).map(([dId, v]) => ({
      program: deptName(dId) ?? dId,
      avg_rating: r2(v.sum / v.n),
      forms: v.n,
    }));

    // ---- 2. Lowest-rated faculty (bottom 10, released only) ----
    const byFaculty: Record<string, { sum: number; n: number }> = {};
    releasedEvals.forEach((e: { faculty_id: string; ratings: Record<string, number> | null }) => {
      const overall = overallOf(e.ratings);
      if (overall === null) return;
      byFaculty[e.faculty_id] = byFaculty[e.faculty_id] ?? { sum: 0, n: 0 };
      byFaculty[e.faculty_id].sum += overall;
      byFaculty[e.faculty_id].n += 1;
    });
    const lowestRated = Object.entries(byFaculty)
      .map(([fid, v]) => ({
        faculty: facultyName(fid),
        program: deptName(facultyDeptId(fid)) ?? null,
        avg_rating: r2(v.sum / v.n),
        forms: v.n,
      }))
      .sort((a, b) => a.avg_rating - b.avg_rating)
      .slice(0, 10);

    // ---- 3. Weak criteria (bottom categories, released only) ----
    const criteriaOfQuestion = new Map<string, string>();
    questionsRows.forEach((q: { id: string; criteria_id: string }) =>
      criteriaOfQuestion.set(q.id, q.criteria_id),
    );
    const byCriteria: Record<string, { sum: number; n: number }> = {};
    releasedEvals.forEach((e: { ratings: Record<string, number> | null }) => {
      if (!e.ratings) return;
      Object.entries(e.ratings).forEach(([qid, score]) => {
        const cId = criteriaOfQuestion.get(qid);
        if (!cId) return;
        const s = Number(score);
        if (!Number.isFinite(s) || s < 1 || s > 5) return;
        byCriteria[cId] = byCriteria[cId] ?? { sum: 0, n: 0 };
        byCriteria[cId].sum += s;
        byCriteria[cId].n += 1;
      });
    });
    const weakCriteria = Object.entries(byCriteria)
      .map(([cId, v]) => ({
        criteria: criteriaRows.find((c: { id: string }) => c.id === cId)?.name ?? cId,
        avg_rating: r2(v.sum / v.n),
        responses: v.n,
      }))
      .sort((a, b) => a.avg_rating - b.avg_rating)
      .slice(0, 8);

    // ---- 4. Moderation / priority counts (all periods) ----
    const flagged = evaluations.filter((e: { moderation_status: string }) => e.moderation_status === "flag").length;
    const allowed = evaluations.filter((e: { moderation_status: string }) => e.moderation_status === "allow").length;
    const priorityBySource: Record<string, number> = {};
    evaluations
      .filter((e: { is_priority: boolean }) => e.is_priority)
      .forEach((e: { priority_source: string | null }) => {
        const src = e.priority_source ?? "unknown";
        priorityBySource[src] = (priorityBySource[src] ?? 0) + 1;
      });

    // ---- 5. Participation gaps (released periods only) ----
    const facultyWithEvals = new Set(releasedEvals.map((e: { faculty_id: string }) => e.faculty_id));
    const gapByProgram: Record<
      string,
      { faculty_total: number; faculty_evaluated: number; forms: number; classes_total: number; classes_with_evals: number }
    > = {};
    visibleFacultyIds.forEach((fid) => {
      const dId = facultyDeptId(fid);
      if (!dId) return;
      gapByProgram[dId] = gapByProgram[dId] ?? { faculty_total: 0, faculty_evaluated: 0, forms: 0, classes_total: 0, classes_with_evals: 0 };
      gapByProgram[dId].faculty_total += 1;
      if (facultyWithEvals.has(fid)) gapByProgram[dId].faculty_evaluated += 1;
    });
    const assignmentsWithEvals = new Set(releasedEvals.map((e: { assignment_id: string }) => e.assignment_id));
    visibleAssignments.forEach((a: { department: string; id: string }) => {
      // Class assignments carry the department TEXT (legacy schema);
      // group them under the matching program row by name.
      // Unmatchable texts are skipped (a scoped admin only ever
      // receives rows whose program matches their assignments).
      const entry = Object.entries(gapByProgram).find(([dId]) => (deptName(dId) ?? "") === a.department);
      if (!entry) return;
      entry[1].classes_total += 1;
      if (assignmentsWithEvals.has(a.id)) entry[1].classes_with_evals += 1;
    });
    releasedEvals.forEach((e: { faculty_id: string }) => {
      const dId = facultyDeptId(e.faculty_id);
      if (dId && gapByProgram[dId]) gapByProgram[dId].forms += 1;
    });
    const participationGaps = Object.entries(gapByProgram).map(([dId, v]) => ({
      program: deptName(dId) ?? dId,
      faculty_total: v.faculty_total,
      faculty_evaluated: v.faculty_evaluated,
      faculty_without_evals: v.faculty_total - v.faculty_evaluated,
      classes_total: v.classes_total,
      classes_with_evals: v.classes_with_evals,
      forms: v.forms,
    }));

    // ---- 6. Trends (released periods only, chronological) ----
    const byPeriod: Record<string, { sum: number; n: number }> = {};
    releasedEvals.forEach((e: { academic_year: string; semester: string; ratings: Record<string, number> | null }) => {
      const overall = overallOf(e.ratings);
      if (overall === null) return;
      const key = `${e.academic_year} ${e.semester}`;
      byPeriod[key] = byPeriod[key] ?? { sum: 0, n: 0 };
      byPeriod[key].sum += overall;
      byPeriod[key].n += 1;
    });
    const trends = Object.entries(byPeriod).map(([period, v]) => ({
      period,
      avg_rating: r2(v.sum / v.n),
      forms: v.n,
    }));

    const digest = {
      scope: {
        viewer_role: profile.role,
        programs: isSuper ? "ALL programs" : assignedDeptIds.map((id) => deptName(id) ?? id),
        note: "All ratings aggregates cover RELEASED periods only. Moderation counts cover all submitted evaluations.",
      },
      program_averages: programAverages,
      lowest_rated_faculty: lowestRated,
      weak_criteria: weakCriteria,
      moderation: {
        submitted_total: evaluations.length,
        comments_allowed: allowed,
        comments_flagged: flagged,
        priority_total: evaluations.filter((e: { is_priority: boolean }) => e.is_priority).length,
        priority_by_source: priorityBySource,
      },
      participation_gaps: participationGaps,
      trends,
    };

    const answer = await chatComplete(digest, question);
    if (!answer) {
      return json(
        { error: "AI analyst is temporarily unavailable. Please try again later." },
        503,
      );
    }

    // --------------------------------------------------------
    // Audit: question + answer + scope recorded (Req 6).
    // --------------------------------------------------------
    const { error: auditErr } = await admin.from("audit_log").insert({
      actor_id: userId,
      actor_role: profile.role,
      action: "ai.analyst",
      entity: "evaluations",
      entity_id: null,
      details: {
        question,
        answer_preview: answer.slice(0, 2000),
        programs_scope: isSuper ? "ALL" : assignedDeptIds.map((id) => deptName(id) ?? id),
        digest_sections: Object.keys(digest).filter((k) => k !== "scope"),
      },
    });
    if (auditErr) {
      return json(
        { error: `Audit log insert failed: ${auditErr.message}` },
        500,
      );
    }

    return json(
      {
        answer: answer.trim(),
        ai_generated: true,
        scope: digest.scope,
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
