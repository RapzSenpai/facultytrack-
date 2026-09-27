import { useEffect, useMemo, useState } from "react";
import { supabase } from "../config/supabase";
import { useAuth } from "../context/AuthContext";

// Shared program-scope for dept admins (D8/D9).
// Super admin => isSuper, sees everything, no filtering.
// Scoped admin => myDeptIds/myDeptNames from admin_program_assignments.
// Unassigned admin => empty lists => sees nothing (D9 strict).
//
// Loading stays true until the profile resolves, so consumers never
// mistake an unresolved profile for a scoped/unassigned admin.
// Query failures surface via `error` instead of silently becoming
// an empty (unassigned-looking) assignment list.
export function useScopedAdmin() {
  const { currentUser, userProfile } = useAuth();
  const profileReady = userProfile !== undefined;
  const isSuper = userProfile?.role === "super_admin";
  const [deptIds, setDeptIds] = useState([]);
  const [deptNames, setDeptNames] = useState([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!profileReady || isSuper || !currentUser) {
      if (!cancelled) {
        setDeptIds([]);
        setDeptNames([]);
        setError(null);
        setLoadingAssignments(false);
      }
      return undefined;
    }
    setLoadingAssignments(true);
    setError(null);
    const load = async () => {
      try {
        const { data: assigns, error: assignErr } = await supabase
          .from("admin_program_assignments")
          .select("department_id")
          .eq("admin_id", currentUser.id);
        if (assignErr) throw assignErr;
        const ids = (assigns || []).map((a) => a.department_id);
        if (cancelled) return;
        setDeptIds(ids);
        if (ids.length === 0) {
          setDeptNames([]);
        } else {
          const { data: depts, error: deptErr } = await supabase
            .from("departments")
            .select("id, name")
            .in("id", ids);
          if (deptErr) throw deptErr;
          if (!cancelled) setDeptNames((depts || []).map((d) => d.name));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err);
          setDeptIds([]);
          setDeptNames([]);
        }
      } finally {
        if (!cancelled) setLoadingAssignments(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [currentUser, isSuper, profileReady]);

  const loading = !profileReady || loadingAssignments;

  // Case-insensitive dept-name matcher for tables carrying TEXT department.
  const inScopeName = useMemo(() => {
    if (isSuper) return () => true;
    const lower = new Set(deptNames.map((n) => String(n).trim().toLowerCase()));
    return (name) => lower.has(String(name || "").trim().toLowerCase());
  }, [isSuper, deptNames]);

  return { isSuper, myDeptIds: deptIds, myDeptNames: deptNames, inScopeName, loading, error };
}
