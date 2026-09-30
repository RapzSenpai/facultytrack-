import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../config/supabase";

// Super-only "act as program" scope for fallback Admin Tools.
// Oversight screens stay global; Dashboard stays global.
// Default: "" = All Programs. Persisted in localStorage.
// Client-side UX only — RLS bypass (break-glass) is unaffected.
const SuperScopeContext = createContext({ scopeDeptId: "", setScopeDeptId: () => {}, scopeDeptName: "" });

export function SuperScopeProvider({ active, children }) {
  const [scopeDeptId, setScopeDeptId] = useState(() => localStorage.getItem("superScopeDept") || "");
  const [departments, setDepartments] = useState([]);

  useEffect(() => {
    if (!active) return;
    supabase.from("departments").select("id, name").order("name")
      .then(({ data }) => { if (data) setDepartments(data); })
      .catch(() => {});
  }, [active]);

  // A deleted program id falls back to All instead of breaking filters.
  const validId = departments.some((d) => d.id === scopeDeptId) ? scopeDeptId : "";
  const scopeDeptName = departments.find((d) => d.id === validId)?.name || "";

  useEffect(() => {
    localStorage.setItem("superScopeDept", scopeDeptId);
    console.log("[super-scope]", scopeDeptId ? `${scopeDeptName || scopeDeptId} (${scopeDeptId})` : "all");
  }, [scopeDeptId, scopeDeptName]);

  return (
    <SuperScopeContext.Provider value={{ scopeDeptId: validId, setScopeDeptId, scopeDeptName, departments }}>
      {children}
    </SuperScopeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSuperScope() {
  return useContext(SuperScopeContext);
}
