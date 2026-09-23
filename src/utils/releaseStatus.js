import { supabase } from "../config/supabase";

// Phase 5: per-period release status for the signed-in faculty
// member (booleans only — no result data crosses RLS anyway).
export async function fetchFacultyReleaseStatus() {
  const { data, error } = await supabase
    .from("faculty_release_status")
    .select("academic_year, semester, has_evaluations, grades_submitted, released");
  if (error) throw error;
  return data || [];
}

// [D3] Faculty self-mark / unmark "grades submitted" for a period.
// The RLS policies pin every row to faculty_id = auth.uid(), so the
// id must be sent but can never target anyone else's rows.
export async function setGradesSubmitted(facultyId, year, semester, submitted) {
  if (submitted) {
    const { error } = await supabase.from("grade_submissions").upsert(
      { faculty_id: facultyId, academic_year: year, semester },
      { onConflict: "faculty_id,academic_year,semester" },
    );
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from("grade_submissions")
    .delete()
    .match({ faculty_id: facultyId, academic_year: year, semester });
  if (error) throw error;
}
