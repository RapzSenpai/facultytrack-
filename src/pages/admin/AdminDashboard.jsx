import { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import "../../styles/dashboard-mockup.css";
export default function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ faculty: 0, students: 0, evaluations: 0, currentPeriodEvals: 0, uniqueParticipants: 0, pendingFaculty: 0, pendingStudents: 0 });
  const [activeYear, setActiveYear] = useState(null);
  const [loading, setLoading] = useState(true);

  // Phase 2 state
  const [chartData, setChartData] = useState([]);
  const [deptData, setDeptData] = useState([]);
  const [topFacultyData, setTopFacultyData] = useState([]);
  const [recentRegistrations, setRecentRegistrations] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [timeRange, setTimeRange] = useState("all"); // "all", "30", "7"
  const [activeTab, setActiveTab] = useState("department"); // "department" or "faculty"

  useEffect(() => {
    Promise.all([
      supabase.from('users').select('*').eq('role', 'faculty'),
      supabase.from('users').select('*').eq('role', 'student'),
      supabase.from('admin_evaluations_anon').select('*'),
      supabase.from('academic_years').select('*'),
      supabase.from('class_assignments').select('*'),
    ])
      .then(([facultyRes, studentsRes, evaluationsRes, yearsRes, assignmentsRes]) => {
        const faculty = facultyRes.data || [];
        const students = studentsRes.data || [];
        const evaluations = evaluationsRes.data || [];
        const years = yearsRes.data || [];
        const assignments = assignmentsRes?.data || [];

        // Map snake_case to camelCase for faculty
        const facultyMapped = faculty.map(f => ({
          ...f,
          firstName: f.first_name,
          lastName: f.last_name,
          fullName: f.full_name,
          createdAt: f.created_at,
        }));

        // Map snake_case to camelCase for students
        const studentsMapped = students.map(s => ({
          ...s,
          firstName: s.first_name,
          lastName: s.last_name,
          fullName: s.full_name,
          createdAt: s.created_at,
        }));

        // Map snake_case to camelCase for evaluations.
        // Phase 4 anonymity: student_id is replaced by student_token
        // (per-row MD5) — distinct-count semantics without identity.
        const evaluationsMapped = evaluations.map(e => ({
          ...e,
          studentId: e.student_token,
          studentDepartment: e.student_department,
          facultyId: e.faculty_id,
          assignmentId: e.assignment_id,
          academicYear: e.academic_year,
          submittedAt: e.submitted_on,
        }));

        // Map snake_case to camelCase for years
        const yearsMapped = years.map(y => ({
          ...y,
          startDate: y.start_date,
          endDate: y.end_date,
        }));

        // Count users by status
        const activeFaculty = facultyMapped.filter(u => (u.status || "active").toLowerCase() === "active").length;
        const pendingFaculty = facultyMapped.filter(u => (u.status || "").toLowerCase() === "pending").length;
        const activeStudents = studentsMapped.filter(u => (u.status || "active").toLowerCase() === "active").length;
        const pendingStudents = studentsMapped.filter(u => (u.status || "").toLowerCase() === "pending").length;

        // Extract recent registrations
        let allUsers = [];
        allUsers = [...allUsers, ...facultyMapped.map(f => ({ ...f, role: "Faculty" }))];
        allUsers = [...allUsers, ...studentsMapped.map(s => ({ ...s, role: "Student" }))];
        const sortedUsers = allUsers.reverse().slice(0, 5);
        setRecentRegistrations(sortedUsers);

        // Extract recent activities (latest evaluations)
        const sortedEvals = [...evaluationsMapped].sort((a, b) => {
          const dateA = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
          const dateB = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
          return dateB - dateA;
        }).slice(0, 5);
        setRecentActivity(sortedEvals);

        // Find current period
        let active = null;
        if (yearsMapped.length > 0) {
          active = yearsMapped.find(y => (y.status || "").toLowerCase().trim() === "on-going") || yearsMapped[0];
          setActiveYear(active);
        }

        // Calculate evaluations specific to this period
        const periodEvalsRaw = active
          ? evaluationsMapped.filter(e => {
            if (e.academicYear !== active.year || e.semester !== active.semester) return false;
            // Ensure the evaluated faculty still exists in the system
            const f = facultyMapped.find(fac => fac.id === e.facultyId);
            if (!f) return false;
            // Ensure the student who submitted it still exists
            const s = studentsMapped.find(st => st.id === e.studentId);
            return !!s;
          })
          : [];

        const periodEvalsCount = periodEvalsRaw.length;
        const uniqueParticipantsCount = new Set(periodEvalsRaw.map(e => e.studentId)).size;

        setStats({
          faculty: activeFaculty,
          students: activeStudents,
          evaluations: evaluationsMapped.length,
          currentPeriodEvals: periodEvalsCount,
          uniqueParticipants: uniqueParticipantsCount,
          pendingFaculty,
          pendingStudents
        });

        // 1. Chart Data
        const dateCounts = {};
        periodEvalsRaw.forEach(e => {
          if (e.submittedAt) {
            try {
              const d = new Date(e.submittedAt);
              if (!isNaN(d.getTime())) {
                const dateStr = d.toISOString().split("T")[0];
                dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
              }
            } catch (err) { console.warn("Date parse error", err); }
          }
        });
        const chartArr = Object.keys(dateCounts).map(date => {
          const d = new Date(date);
          return {
            dateStr: date, // YYYY-MM-DD
            dateDisplay: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            submissions: dateCounts[date],
            rawDate: d
          };
        }).sort((a, b) => a.rawDate - b.rawDate);
        setChartData(chartArr);

        // 2. Department Participation Data
        const deptMap = {};
        studentsMapped.filter(s => s.status === "active").forEach(s => {
          const d = s.department || "Unassigned";
          if (!deptMap[d]) deptMap[d] = { dept: d, totalStudents: 0, participants: new Set() };
          deptMap[d].totalStudents++;
        });
        periodEvalsRaw.forEach(e => {
          // Participant's program comes from the anonymous view
          // (student_department) — no identity read needed.
          const d = e.studentDepartment || "Unassigned";
          if (deptMap[d]) deptMap[d].participants.add(e.studentId);
        });
        const deptArr = Object.values(deptMap).map(d => ({
          department: d.dept,
          totalStudents: d.totalStudents,
          participated: d.participants.size,
          rate: d.totalStudents > 0 ? Math.round((d.participants.size / d.totalStudents) * 100) : 0
        })).sort((a, b) => b.rate - a.rate);
        setDeptData(deptArr);

        // 3. Top Rated Faculty Data
        const facMap = {};
        periodEvalsRaw.forEach(e => {
          if (!facMap[e.facultyId]) facMap[e.facultyId] = { totalRating: 0, count: 0 };
          if (e.ratings) {
            const vals = Object.values(e.ratings).map(Number).filter(n => !isNaN(n));
            if (vals.length > 0) {
              const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
              facMap[e.facultyId].totalRating += avg;
              facMap[e.facultyId].count++;
            }
          }
        });
        const facArr = [];
        Object.keys(facMap).forEach(id => {
          const f = facultyMapped.find(fac => fac.id === id);
          if (f) {
            const assignDept = assignments.find(a => (a.faculty_id === id || a.facultyId === id) && a.department)?.department;
            const dept = f.department || assignDept || "—";
            facArr.push({
              id,
              name: f.fullName || (f.firstName && f.lastName ? `${f.firstName} ${f.lastName}` : (f.firstName || f.lastName || "Faculty Member")),
              department: dept,
              avgRating: facMap[id].count > 0 ? (facMap[id].totalRating / facMap[id].count).toFixed(2) : "0.00",
              evals: facMap[id].count
            });
          }
        });
        facArr.sort((a, b) => b.avgRating - a.avgRating);
        setTopFacultyData(facArr.slice(0, 5));
      })
      .catch(err => console.error("Dashboard fetch error:", err))
      .finally(() => setLoading(false));
  }, []);

  // Filter chart data based on time range
  const filteredChartData = useMemo(() => {
    if (timeRange === "all" || chartData.length === 0) return chartData;
    const now = new Date();
    const daysToSubtract = timeRange === "7" ? 7 : 30;
    const cutoff = new Date(now.setDate(now.getDate() - daysToSubtract));
    return chartData.filter(d => d.rawDate >= cutoff);
  }, [chartData, timeRange]);

  return (
    <AdminLayout title="Dashboard">
      <div className="ad-content">
        <div className="mockup-dashboard">
          {/* Header Section */}
          <div className="mockup-header">
            <div>
              <div className="mockup-welcome">
                <h2>
                  Welcome, Admin! <span style={{ fontSize: "1.2rem" }}></span>
                </h2>
                <p>Monitor faculty evaluations, user activities, and academic management.</p>
              </div>
              <div className="mockup-quick-actions">
                <button className="mockup-btn" onClick={() => navigate('/admin/report')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                  View Reports
                </button>
                <button className="mockup-btn" onClick={() => navigate('/admin/faculty')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                  Manage Users
                </button>
                <button className="mockup-btn" onClick={() => navigate('/admin/questionnaire')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                  Questionnaire
                </button>
                <button className="mockup-btn" onClick={() => navigate('/admin/academic-year')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  Academic Year
                </button>
              </div>
            </div>

            <div className="mockup-period-card">
              <div className="mockup-period-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              </div>
              <div className="mockup-period-info">
                <div className="mockup-period-label">Current Academic Period</div>
                <div className="mockup-period-title">
                  {activeYear ? `${activeYear.year} • ${activeYear.semester}` : "No active year"}
                </div>
                <div className="mockup-period-status">
                  Evaluation Status: <span className="mockup-status-badge">{(activeYear?.status || "").toLowerCase().trim() === "on-going" ? "On-going" : "Closed"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 4 Stats Cards */}
          <div className="mockup-stats-grid">
            <div className="mockup-stat-card">
              <div className="mockup-stat-header">
                <span className="mockup-stat-title">Total Faculty</span>
                <div className="mockup-stat-icon blue">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                </div>
              </div>
              <div className="mockup-stat-value">{loading ? "—" : stats.faculty}</div>
              <div className="mockup-stat-desc">Active faculty members</div>
              <div className="mockup-stat-trend"><span>↑ 1</span> This semester</div>
            </div>

            <div className="mockup-stat-card">
              <div className="mockup-stat-header">
                <span className="mockup-stat-title">Total Students</span>
                <div className="mockup-stat-icon green">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                </div>
              </div>
              <div className="mockup-stat-value">{loading ? "—" : stats.students}</div>
              <div className="mockup-stat-desc">Active enrolled students</div>
              <div className="mockup-stat-trend green"><span>↑ 2</span> This semester</div>
            </div>

            <div className="mockup-stat-card">
              <div className="mockup-stat-header">
                <span className="mockup-stat-title">Forms Submitted</span>
                <div className="mockup-stat-icon purple">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                </div>
              </div>
              <div className="mockup-stat-value">{loading ? "—" : stats.currentPeriodEvals}</div>
              <div className="mockup-stat-desc">For the ongoing semester</div>
              <div className="mockup-stat-trend"><span>↑ 3</span> This semester</div>
            </div>

            <div className="mockup-stat-card">
              <div className="mockup-stat-header">
                <span className="mockup-stat-title">Pending Approvals</span>
                <div className="mockup-stat-icon orange">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                </div>
              </div>
              <div className="mockup-stat-value">{stats.pendingFaculty + stats.pendingStudents}</div>
              <div className="mockup-stat-desc">Requires your action</div>
              <div className="mockup-stat-trend">
                {stats.pendingFaculty + stats.pendingStudents > 0 ? (
                  <Link to="/admin/faculty" style={{ color: '#ea580c', fontWeight: 'bold', textDecoration: 'none', background: '#ffedd5', padding: '2px 8px', borderRadius: '4px' }}>Review Now →</Link>
                ) : (
                  <span style={{ color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: '4px' }}>All caught up</span>
                )}
              </div>
            </div>
          </div>

          {/* Middle Row */}
          <div className="mockup-grid-3">
            <div className="mockup-panel">
              <div className="mockup-panel-header">
                <div>
                  <h3 className="mockup-panel-title">Recent Registrations</h3>
                  <p className="mockup-panel-subtitle">Latest faculty and student accounts.</p>
                </div>
                <a href="#" className="mockup-panel-action">View all →</a>
              </div>
              <div className="mockup-table-wrapper">
                <table className="mockup-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Department</th>
                      <th>Status</th>
                      <th>Registered On</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRegistrations.length === 0 ? (
                      <tr><td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: '#6b7280' }}>No recent registrations</td></tr>
                    ) : (
                      recentRegistrations.map((user, i) => (
                        <tr key={user.id || user.uid || i}>
                          <td><span className="mockup-avatar">{(user.fullName || user.firstName || 'U').substring(0, 2).toUpperCase()}</span> {user.fullName || `${user.firstName} ${user.lastName}`}</td>
                          <td>{user.role}</td>
                          <td>{user.department || '—'}</td>
                          <td><span className={`mockup-badge ${user.status?.toLowerCase() === 'pending' ? 'pending' : 'approved'}`}>{user.status || 'Active'}</span></td>
                          <td>{user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recently'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mockup-panel">
              <div className="mockup-panel-header">
                <div>
                  <h3 className="mockup-panel-title">Evaluation Summary</h3>
                  <p className="mockup-panel-subtitle">Overview of the ongoing semester.</p>
                </div>
                <a href="#" className="mockup-panel-action">View details →</a>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%' }}>
                <div className="mockup-donut-container" style={{ width: '120px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Participated', value: stats.uniqueParticipants, fill: '#0f1f3a' },
                          { name: 'Remaining', value: Math.max(0, stats.students - stats.uniqueParticipants), fill: '#e5e7eb' }
                        ]}
                        innerRadius={50}
                        outerRadius={60}
                        paddingAngle={0}
                        dataKey="value"
                        stroke="none"
                      >
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mockup-donut-text">
                    <div className="mockup-donut-pct">{stats.students > 0 ? Math.round((stats.uniqueParticipants / stats.students) * 100) : 0}%</div>
                    <div className="mockup-donut-lbl">Participation</div>
                  </div>
                </div>
                <div className="mockup-donut-legend" style={{ flex: 1, paddingLeft: '20px' }}>
                  <div className="mockup-legend-item">
                    <span className="mockup-legend-label">Total Students</span>
                    <span className="mockup-legend-value">{stats.students}</span>
                  </div>
                  <div className="mockup-legend-item">
                    <span className="mockup-legend-label">Students Participated</span>
                    <span className="mockup-legend-value">{stats.uniqueParticipants}</span>
                  </div>
                  <div className="mockup-legend-item">
                    <span className="mockup-legend-label">Forms Submitted</span>
                    <span className="mockup-legend-value">{stats.currentPeriodEvals}</span>
                  </div>
                  <div className="mockup-legend-item">
                    <span className="mockup-legend-label">Remaining</span>
                    <span className="mockup-legend-value">{Math.max(0, stats.students - stats.uniqueParticipants)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mockup-panel">
              <div className="mockup-panel-header" style={{ marginBottom: '12px' }}>
                <div>
                  <h3 className="mockup-panel-title">Upcoming Tasks</h3>
                  <p className="mockup-panel-subtitle">Tasks that require your attention.</p>
                </div>
              </div>
              <div className="mockup-tasks-list">
                <div className="mockup-task-item">
                  <div className="mockup-task-icon blue">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                  </div>
                  <div className="mockup-task-content">
                    <h4 className="mockup-task-title">Review faculty accounts</h4>
                    <p className="mockup-task-desc">{stats.pendingFaculty} new registration{stats.pendingFaculty !== 1 ? 's' : ''}</p>
                  </div>
                  <div className={`mockup-task-count ${stats.pendingFaculty > 0 ? 'blue' : ''}`}>{stats.pendingFaculty}</div>
                </div>
                <div className="mockup-task-item">
                  <div className="mockup-task-icon green">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                  </div>
                  <div className="mockup-task-content">
                    <h4 className="mockup-task-title">Review student accounts</h4>
                    <p className="mockup-task-desc">{stats.pendingStudents} new registration{stats.pendingStudents !== 1 ? 's' : ''}</p>
                  </div>
                  <div className={`mockup-task-count ${stats.pendingStudents > 0 ? 'green' : ''}`} style={stats.pendingStudents > 0 ? { background: '#dcfce7', color: '#16a34a' } : {}}>{stats.pendingStudents}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Row */}
          <div className="mockup-grid-3-bottom">
            <div className="mockup-panel">
              <div className="mockup-panel-header" style={{ marginBottom: '24px' }}>
                <div>
                  <h3 className="mockup-panel-title">Participation by Program</h3>
                  <p className="mockup-panel-subtitle">Evaluation participation rate per program.</p>
                </div>
                <a href="#" className="mockup-panel-action">View all →</a>
              </div>
              <div>
                {loading ? (
                  <div style={{ textAlign: 'center', color: '#6b7280', padding: '20px' }}>Loading...</div>
                ) : deptData.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#6b7280', padding: '20px' }}>No data</div>
                ) : (
                  deptData.slice(0, 5).map((d, i) => (
                    <div className="mockup-prog-item" key={i}>
                      <div className="mockup-prog-name">{d.department}</div>
                      <div className="mockup-prog-pct">{d.rate}%</div>
                      <div className="mockup-prog-bar-bg">
                        <div className="mockup-prog-bar-fill" style={{ width: `${d.rate}%` }}></div>
                      </div>
                      <div className="mockup-prog-count">{d.participated} / {d.totalStudents} students</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mockup-panel">
              <div className="mockup-panel-header" style={{ marginBottom: '16px' }}>
                <div>
                  <h3 className="mockup-panel-title">Top Rated Faculty</h3>
                  <p className="mockup-panel-subtitle">Based on average evaluation ratings.</p>
                </div>
                <button
                  type="button"
                  className="mockup-panel-action"
                  onClick={() => navigate('/admin/report')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  View all →
                </button>
              </div>
              <div>
                {loading ? (
                  <div style={{ textAlign: 'center', color: '#6b7280', padding: '20px' }}>Loading...</div>
                ) : topFacultyData.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#6b7280', padding: '20px' }}>No data</div>
                ) : (
                  topFacultyData.slice(0, 5).map((f, i) => (
                    <div className="mockup-fac-item" key={f.id}>
                      <div className={`mockup-fac-rank ${i < 3 ? 'top' : ''}`}>{i + 1}</div>
                      <div className="mockup-fac-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>
                      <div className="mockup-fac-name">{f.name}</div>
                      <div className="mockup-fac-dept">{f.department && f.department !== "Unknown" ? f.department : "—"}</div>
                      <div className="mockup-fac-rating">{f.avgRating}</div>
                      <div className="mockup-fac-evals">{f.evals} evals</div>
                    </div>
                  ))
                )}
              </div>
            </div>


          </div>

        </div>
      </div>
    </AdminLayout>
  );
}
