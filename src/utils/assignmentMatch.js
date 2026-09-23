export function normalizeYear(y) {
  if (!y) return "";
  const str = String(y).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (str.includes("1") || str.includes("first")) return "1";
  if (str.includes("2") || str.includes("second")) return "2";
  if (str.includes("3") || str.includes("third")) return "3";
  if (str.includes("4") || str.includes("fourth")) return "4";
  return str;
}

export function normalizeSection(s) {
  if (!s) return "";
  return String(s).toLowerCase().replace(/section/g, "").replace(/[^a-z0-9]/g, "");
}

export function normalizeDept(d) {
  if (!d) return "";
  return String(d).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isAssignmentMatch(assignment, studentDept, studentYear, studentSection) {
  const deptValue = normalizeDept(assignment?.department);
  const yearValue = normalizeYear(assignment?.yearLevel);
  const sectionValue = normalizeSection(assignment?.section);

  const deptMatch = deptValue !== "" && deptValue === normalizeDept(studentDept);
  const yearMatch = yearValue !== "" && yearValue === normalizeYear(studentYear);
  const sectionMatch = sectionValue !== "" && sectionValue === normalizeSection(studentSection);

  return deptMatch && yearMatch && sectionMatch;
}
