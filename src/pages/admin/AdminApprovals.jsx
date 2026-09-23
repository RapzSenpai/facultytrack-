import { useState, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { Check, X, Search, AlertCircle, IdCard } from "lucide-react";
import { logAdminAction } from "../../utils/audit";

export default function AdminApprovals() {
    const [activeTab, setActiveTab] = useState("faculty");
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(false);

    const [pendingFaculty, setPendingFaculty] = useState([]);
    const [pendingStudents, setPendingStudents] = useState([]);
    const [toastMsg, setToastMsg] = useState("");
    const [fetchError, setFetchError] = useState("");
    const [photoViewer, setPhotoViewer] = useState({ open: false, url: "", name: "" });

    const fetchApprovals = async () => {
        setLoading(true);
        setFetchError("");
        try {
            const [fRes, sRes] = await Promise.all([
                supabase.from('users').select('*').eq('role', 'faculty'),
                supabase.from('users').select('*').eq('role', 'student'),
            ]);
            if (fRes.error || sRes.error) {
                throw new Error((fRes.error || sRes.error).message);
            }
            const mapUser = (u) => ({
                ...u,
                fullName: u.full_name,
                schoolId: u.school_id,
                yearLevel: u.year_level,
                schoolIdPhotoPath: u.school_id_photo_path,
            });
            const fData = (fRes.data || []).map(mapUser);
            const sData = (sRes.data || []).map(mapUser);

            setPendingFaculty(fData.filter(u => u.status === 'pending'));
            setPendingStudents(sData.filter(u => u.status === 'pending'));
        } catch (err) {
            console.error("Fetch error:", err);
            setFetchError("Could not load pending accounts: " + (err.message || "permission denied."));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchApprovals();
    }, []);

    const handleApprove = async (uid) => {
        if (window.confirm("Approve this account?")) {
            try {
                // NOTE: PostgREST returns success with ZERO rows when RLS
                // filters the target (e.g. other-program user) — that is
                // not an error object, so verify a row actually changed.
                const { data, error } = await supabase.from('users').update({
                    status: 'active',
                    approved_at: new Date().toISOString(),
                }).eq('id', uid).select('id');
                if (error) throw error;
                if (!data || data.length === 0) {
                    throw new Error("Nothing was updated — you may not have permission for this user's program, or the account no longer exists.");
                }
                logAdminAction("account.approve", "users", uid, {});
                setToastMsg("Account approved successfully! User can now log in.");
                fetchApprovals();
                setTimeout(() => setToastMsg(""), 3500);
            } catch (err) {
                console.error("Approve error:", err);
                alert("Could not approve the account: " + (err.message || "permission denied."));
            }
        }
    };

    const handleReject = async (uid) => {
        if (window.confirm("Reject this account? This will permanently delete the user account.")) {
            try {
                // Remove the ID photo (D12: photos live only as long as the
                // account; rejection deletes both). Storage errors don't
                // block the account deletion itself.
                const target = [...pendingFaculty, ...pendingStudents].find(u => (u.uid || u.id) === uid);
                if (target?.schoolIdPhotoPath) {
                    const { error: photoErr } = await supabase.storage
                        .from('school-id-photos')
                        .remove([target.schoolIdPhotoPath]);
                    if (photoErr) console.warn("ID photo cleanup failed:", photoErr.message);
                }
                const { error } = await supabase.rpc('delete_user_account', { target_user_id: uid });
                if (error) {
                    console.warn("Reject RPC error, attempting direct delete:", error);
                    const { data: delData, error: delError } = await supabase.from('users').delete().eq('id', uid).select('id');
                    if (delError) throw delError;
                    if (!delData || delData.length === 0) {
                        throw new Error("Nothing was deleted — you may not have permission for this user's program, or the account no longer exists.");
                    }
                }
                logAdminAction("account.reject", "users", uid, {});
                setToastMsg("Account rejected and removed successfully.");
                fetchApprovals();
                setTimeout(() => setToastMsg(""), 3500);
            } catch (err) {
                console.error("Reject error:", err);
                alert("Could not reject user: " + (err.message || "Permission denied."));
            }
        }
    };

    const activeList = activeTab === "faculty" ? pendingFaculty : pendingStudents;

    // Short-TTL signed URL. The audit RPC runs AFTER the URL is
    // successfully created, so a failed view never logs as viewed.
    const handleViewPhoto = async (user) => {
        if (!user.schoolIdPhotoPath) return;
        try {
            const { data, error } = await supabase.storage
                .from('school-id-photos')
                .createSignedUrl(user.schoolIdPhotoPath, 60);
            if (error) throw error;
            const { error: logErr } = await supabase.rpc('log_id_photo_view', { p_path: user.schoolIdPhotoPath });
            if (logErr) console.warn("Photo view audit failed:", logErr.message);
            setPhotoViewer({ open: true, url: data.signedUrl, name: user.fullName });
        } catch (err) {
            console.error("Photo view error:", err);
            alert("Could not load the ID photo: " + (err.message || "unknown error."));
        }
    };

    const filteredList = activeList.filter(user =>
        (user.fullName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (user.schoolId || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (user.email || "").toLowerCase().includes(searchQuery.toLowerCase())
    );

  
  return (
        <AdminLayout title={<span style={{ color: '#9ca3af' }}>Admin &gt; <strong style={{ color: '#111827' }}>Approvals</strong></span>}>
            <section className="ad-content">

                {/* HEADER */}
                <div className="ad-welcomeHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div>
                        <h2 className="ad-title">Approvals</h2>
                        <p className="ad-subtitle">Review and approve self-registered faculty and student accounts</p>
                    </div>
                    <div style={{ background: '#fffbeb', color: '#b45309', padding: '6px 14px', borderRadius: '999px', fontWeight: '700', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #fef3c7', marginTop: '10px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b' }} />
                        {pendingFaculty.length + pendingStudents.length} Pending
                    </div>
                </div>

                {toastMsg && (
                    <div style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '12px 18px', borderRadius: '10px', fontWeight: '700', fontSize: '13.5px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Check size={18} />
                        <span>{toastMsg}</span>
                    </div>
                )}

                {fetchError && (
                    <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', padding: '12px 18px', borderRadius: '10px', fontWeight: '600', fontSize: '13.5px', marginBottom: '20px' }}>
                        {fetchError}
                    </div>
                )}

                {/* TABS */}
                <div style={{ display: 'flex', gap: '24px', borderBottom: '1px solid #e5e7eb', marginBottom: '24px', overflowX: 'auto', scrollbarWidth: 'none' }}>
                    <button
                        onClick={() => setActiveTab("faculty")}
                        style={{
                            background: 'none', border: 'none', borderBottom: activeTab === "faculty" ? '2px solid #1e3a5f' : '2px solid transparent',
                            padding: '12px 4px', fontSize: '14px', fontWeight: activeTab === "faculty" ? '700' : '600',
                            color: activeTab === "faculty" ? '#1e3a5f' : '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                            whiteSpace: 'nowrap', transition: 'all 0.2s ease'
                        }}
                    >
                        Faculty Approvals
                        <span style={{ background: activeTab === "faculty" ? '#f3f4f6' : 'transparent', color: activeTab === "faculty" ? '#374151' : '#9ca3af', padding: '2px 8px', borderRadius: '12px', fontSize: '11px' }}>
                            {pendingFaculty.length}
                        </span>
                    </button>
                    <button
                        onClick={() => setActiveTab("student")}
                        style={{
                            background: 'none', border: 'none', borderBottom: activeTab === "student" ? '2px solid #1e3a5f' : '2px solid transparent',
                            padding: '12px 4px', fontSize: '14px', fontWeight: activeTab === "student" ? '700' : '600',
                            color: activeTab === "student" ? '#1e3a5f' : '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                            whiteSpace: 'nowrap', transition: 'all 0.2s ease'
                        }}
                    >
                        Student Approvals
                        <span style={{ background: activeTab === "student" ? '#f3f4f6' : 'transparent', color: activeTab === "student" ? '#374151' : '#9ca3af', padding: '2px 8px', borderRadius: '12px', fontSize: '11px' }}>
                            {pendingStudents.length}
                        </span>
                    </button>
                </div>

                <div className="ad-tableCard" style={{ padding: '24px' }}>
                    {/* TOOLBAR */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>
                        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                            <div style={{ position: 'relative', width: '100%', maxWidth: '360px', flexGrow: 1 }}>
                                <Search size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                                <input
                                    type="text"
                                    placeholder="Search by name, ID or email"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    style={{ width: '100%', padding: '10px 14px 10px 38px', borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '14px', outline: 'none', background: '#f9fafb', boxSizing: 'border-box' }}
                                />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 16px', flexShrink: 0 }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
                                <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>Status: Pending</span>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: '#6b7280' }}>
                            <AlertCircle size={14} />
                            Only users who have verified their email appear in this list.
                        </div>
                    </div>

                    {/* TABLE */}
                    <div className="ad-tableWrap" style={{ border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                        <table className="ad-table" style={{ margin: 0 }}>
                            <thead style={{ background: '#f9fafb' }}>
                                <tr>
                                    <th style={{ color: '#4b5563' }}>Name</th>
                                    <th style={{ color: '#4b5563' }}>ID</th>
                                    <th style={{ color: '#4b5563' }}>{activeTab === "faculty" ? "Program" : "Year & Section"}</th>
                                    <th style={{ color: '#4b5563' }}>Email</th>
                                    <th style={{ color: '#4b5563', textAlign: 'center' }}>ID Photo</th>

                                    <th style={{ color: '#4b5563', textAlign: 'center' }}>Status</th>
                                    <th style={{ color: '#4b5563', textAlign: 'center' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan="7" style={{ textAlign: "center", padding: "40px", color: "#6b7280" }}>Loading...</td>
                                    </tr>
                                ) : filteredList.length > 0 ? (
                                    filteredList.map(user => (
                                        <tr key={user.uid || user.id}>
                                            <td style={{ minWidth: '180px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#e0e7ff', color: '#4338ca', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700' }}>
                                                        {user.fullName ? user.fullName.substring(0, 2).toUpperCase() : "??"}
                                                    </div>
                                                    <div>
                                                        <div className="ad-name">{user.fullName}</div>
                                                        <div style={{ fontSize: '11.5px', color: '#6b7280', marginTop: '2px' }}>
                                                            {activeTab === "faculty" ? "Faculty Member" : (user.department || "Student")}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="ad-code">{user.schoolId || user.employeeId}</td>
                                            <td>
                                                {activeTab === "faculty" ? (
                                                    <span style={{ display: 'inline-block', padding: '4px 10px', background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '999px', fontSize: '11px', fontWeight: '700', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                                                        {user.department || "—"}
                                                    </span>
                                                ) : (
                                                    <span style={{ display: 'inline-block', padding: '4px 12px', background: '#f0f4f8', color: '#1e3a5f', border: '1px solid #d1d9e6', borderRadius: '999px', fontSize: '11px', fontWeight: '800', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                                                        {user.yearLevel || ""} - {user.section || ""}
                                                    </span>
                                                )}
                                            </td>
                                            <td>
                                                <div style={{ fontSize: '13px', color: '#374151' }}>{user.email}</div>
                                                <div style={{ fontSize: '11px', color: '#059669', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                                                    <Check size={10} /> Verified
                                                </div>
                                            </td>


                                            <td style={{ textAlign: 'center' }}>
                                                {user.schoolIdPhotoPath ? (
                                                    <button
                                                        onClick={() => handleViewPhoto(user)}
                                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '5px 10px', borderRadius: '6px', fontSize: '11.5px', fontWeight: '600', cursor: 'pointer' }}
                                                    >
                                                        <IdCard size={13} /> View
                                                    </button>
                                                ) : (
                                                    <span style={{ display: 'inline-block', padding: '4px 10px', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '999px', fontSize: '10px', fontWeight: '800', letterSpacing: '0.5px' }}>
                                                        MISSING
                                                    </span>
                                                )}
                                            </td>

                                            <td style={{ textAlign: 'center' }}>
                                                <span style={{ display: 'inline-block', padding: '4px 10px', background: '#fffbeb', color: '#b45309', border: '1px solid #fef3c7', borderRadius: '999px', fontSize: '10px', fontWeight: '800', letterSpacing: '0.5px' }}>
                                                    PENDING
                                                </span>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                                    <button
                                                        onClick={() => handleApprove(user.uid || user.id)}
                                                        style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#059669', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', transition: 'opacity 0.2s' }}
                                                        onMouseOver={e => e.currentTarget.style.opacity = 0.9}
                                                        onMouseOut={e => e.currentTarget.style.opacity = 1}
                                                    >
                                                        <Check size={14} /> Approve
                                                    </button>
                                                    <button
                                                        onClick={() => handleReject(user.uid || user.id)}
                                                        style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#fff', color: '#dc2626', border: '1px solid #fca5a5', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', transition: 'background 0.2s' }}
                                                        onMouseOver={e => e.currentTarget.style.background = '#fef2f2'}
                                                        onMouseOut={e => e.currentTarget.style.background = '#fff'}
                                                    >
                                                        <X size={14} /> Reject
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan="7" style={{ textAlign: "center", padding: "40px", color: "#6b7280" }}>
                                            No pending {activeTab} approvals found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div style={{ marginTop: '24px', display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'space-between', alignItems: 'center', fontSize: '13.5px', color: '#6b7280' }}>
                        <div>
                            Showing <span style={{ fontWeight: '700', color: '#374151' }}>{filteredList.length}</span> of <span style={{ fontWeight: '700', color: '#374151' }}>{filteredList.length}</span> pending accounts
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <button style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', color: '#9ca3af', cursor: 'not-allowed' }}>&lt;</button>
                            <button style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: '6px', background: '#1e3a5f', color: '#fff', fontWeight: '600' }}>1</button>
                            <button style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', color: '#9ca3af', cursor: 'not-allowed' }}>&gt;</button>
                        </div>
                    </div>
                </div>

            </section>

            {photoViewer.open && (
                <div className="ad-modal">
                    <div className="ad-modalOverlay" onClick={() => setPhotoViewer({ open: false, url: "", name: "" })} />
                    <div className="ad-modalContent" style={{ maxWidth: '480px' }}>
                        <div className="ad-modalHeader">
                            <h3 className="ad-modalTitle">School ID — {photoViewer.name}</h3>
                            <button className="ad-modalClose" onClick={() => setPhotoViewer({ open: false, url: "", name: "" })}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="ad-modalBody" style={{ textAlign: 'center' }}>
                            <img
                                src={photoViewer.url}
                                alt={`School ID of ${photoViewer.name}`}
                                style={{ maxWidth: '100%', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                            />
                            <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '10px' }}>
                                Private image. This view is recorded in the audit log.
                            </p>
                        </div>
                        <div className="ad-modalFooter">
                            <button className="ad-btnSecondary" onClick={() => setPhotoViewer({ open: false, url: "", name: "" })}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
}
