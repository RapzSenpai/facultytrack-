import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";

import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import PendingApproval from "./pages/PendingApproval.jsx";
import StudentDashboard from "./pages/student/StudentDashboard.jsx";
import StudentEvaluation from "./pages/student/StudentEvaluation.jsx";
import StudentProfile from "./pages/student/StudentProfile.jsx";
import FacultyDashboard from "./pages/faculty/FacultyDashboard.jsx";
import FacultyEvalResult from "./pages/faculty/FacultyEvalResult.jsx";
import FacultyProfile from "./pages/faculty/FacultyProfile.jsx";
import AdminDashboard from "./pages/admin/AdminDashboard.jsx";
import AdminFaculty from "./pages/admin/AdminFaculty.jsx";
import AdminStudent from "./pages/admin/AdminStudent.jsx";
import AdminDepartment from "./pages/admin/AdminDepartment.jsx";
import AdminSubject from "./pages/admin/AdminSubject.jsx";
import AdminAcademicYear from "./pages/admin/AdminAcademicYear.jsx";
import AdminQuestionnaire from "./pages/admin/AdminQuestionnaire.jsx";
import AdminCriteria from "./pages/admin/AdminCriteria.jsx";
import AdminReport from "./pages/admin/AdminReport.jsx";
import AdminClassAssignment from "./pages/admin/AdminClassAssignment.jsx";
import AdminProfile from "./pages/admin/AdminProfile.jsx";
import AdminApprovals from "./pages/admin/AdminApprovals.jsx";
import AdminSubjectCorrections from "./pages/admin/AdminSubjectCorrections.jsx";

function NotFound() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "#6b7280", fontFamily: "sans-serif" }}>
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" style={{ marginBottom: "16px" }}>
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <h1 style={{ fontSize: "48px", fontWeight: 700, color: "#1f2937", margin: 0 }}>404</h1>
      <p style={{ fontSize: "16px", marginTop: "8px" }}>Page not found.</p>
      <a href="/" style={{ marginTop: "16px", color: "#2563eb", textDecoration: "none", fontSize: "14px" }}>← Back to Home</a>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/pending-approval" element={<PendingApproval />} />

          {/* Student routes */}
          <Route path="/student/dashboard" element={<ProtectedRoute role="student"><StudentDashboard /></ProtectedRoute>} />
          <Route path="/student/evaluate" element={<ProtectedRoute role="student"><StudentEvaluation /></ProtectedRoute>} />
          <Route path="/student/profile" element={<ProtectedRoute role="student"><StudentProfile /></ProtectedRoute>} />

          {/* Faculty routes */}
          <Route path="/faculty/dashboard" element={<ProtectedRoute role="faculty"><FacultyDashboard /></ProtectedRoute>} />
          <Route path="/faculty/evaluations" element={<ProtectedRoute role="faculty"><FacultyEvalResult /></ProtectedRoute>} />
          <Route path="/faculty/profile" element={<ProtectedRoute role="faculty"><FacultyProfile /></ProtectedRoute>} />

          {/* Admin routes */}
          <Route path="/admin/dashboard" element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/faculty" element={<ProtectedRoute role="admin"><AdminFaculty /></ProtectedRoute>} />
          <Route path="/admin/student" element={<ProtectedRoute role="admin"><AdminStudent /></ProtectedRoute>} />
          <Route path="/admin/department" element={<ProtectedRoute role="admin"><AdminDepartment /></ProtectedRoute>} />
          <Route path="/admin/subject" element={<ProtectedRoute role="admin"><AdminSubject /></ProtectedRoute>} />
          <Route path="/admin/class-assignment" element={<ProtectedRoute role="admin"><AdminClassAssignment /></ProtectedRoute>} />
          <Route path="/admin/academic-year" element={<ProtectedRoute role="admin"><AdminAcademicYear /></ProtectedRoute>} />
          <Route path="/admin/questionnaire" element={<ProtectedRoute role="admin"><AdminQuestionnaire /></ProtectedRoute>} />
          <Route path="/admin/criteria" element={<ProtectedRoute role="admin"><AdminCriteria /></ProtectedRoute>} />
          <Route path="/admin/report" element={<ProtectedRoute role="admin"><AdminReport /></ProtectedRoute>} />
          <Route path="/admin/profile" element={<ProtectedRoute role="admin"><AdminProfile /></ProtectedRoute>} />
          <Route path="/admin/approvals" element={<ProtectedRoute role="admin"><AdminApprovals /></ProtectedRoute>} />
          <Route path="/admin/subject-corrections" element={<ProtectedRoute role="admin"><AdminSubjectCorrections /></ProtectedRoute>} />

          {/* 404 fallback */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
