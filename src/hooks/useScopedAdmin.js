import { useEffect, useMemo, useState } from "react";
import { supabase } from "../config/supabase";
import { useAuth } from "../context/AuthContext";

// Shared program-scope for dept admins (D8/D9).
// Super admin => isSuper, sees everything, no filtering.
// Scoped admin => myDeptIds/myDeptNames from admin_program_assignments.
// Unassigned admin => empty lists => sees nothing (D9 strict).
export function useScopedAdmin() {
  const { currentUser, userProfile } = useAuth();
  const isSuper = userProfile?.role === "super_admin";
  const [deptIds, setDeptIds] = useState([]);
  const [deptNames, setDeptNames] = useState([]);
  const [loading, setLoading] = useState(!isSuper);

  useEffect(() => {
    let cancelled = false;
    if (isSuper || !currentUser) {
      setDeptIds([]);
      setDeptNames([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const load = async () => {
      try {
        const { data: assigns } = await supabase
          .from("admin_program_assignments")
          .select("department_id")
          .eq("admin_id", currentUser.id);
        const ids = (assigns || []).map((a) => a.department_id);
        if (cancelled) return;
        setDeptIds(ids);
        if (ids.length === 0) {
          setDeptNames([]);
        } else {
          const { data: depts } = await supabase
            .from("departments")
            .select("id, name")
            .in("id", ids);
          if (!cancelled) setDeptNames((depts || []).map((d) => d.name));
        }
      } catch {
        if (!cancelled) {
          setDeptIds([]);
          setDeptNames([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [currentUser, isSuper]);

  // Case-insensitive dept-name matcher for tables carrying TEXT department.
  const inScopeName = useMemo(() => {
    if (isSuper) return () => true;
    const lower = new Set(deptNames.map((n) => String(n).trim().toLowerCase()));
    return (name) => lower.has(String(name || "").trim().toLowerCase());
  }, [isSuper, deptNames]);

  return { isSuper, myDeptIds: deptIds, myDeptNames: deptNames, inScopeName, loading };
}
