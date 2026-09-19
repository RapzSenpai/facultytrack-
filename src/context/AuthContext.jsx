import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../config/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(undefined);
  const [userProfile, setUserProfile] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setUserProfile(null);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setUserProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) throw error;
      setUserProfile({
        fullName: data.full_name,
        firstName: data.first_name,
        lastName: data.last_name,
        schoolId: data.school_id,
        yearLevel: data.year_level,
        department: data.department,
        section: data.section,
        contactNumber: data.contact_number,
        photoUrl: data.photo_url,
        email: data.email,
        role: data.role,
        status: data.status,
        position: data.position,
        specialization: data.specialization,
        officeLocation: data.office_location,
      });
    } catch {
      setUserProfile(null);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setUserProfile(null);
  };

  const refreshUserProfile = async () => {
    if (currentUser) {
      await fetchProfile(currentUser.id);
    }
  };

  const ready = currentUser !== undefined && userProfile !== undefined;

  return (
    <AuthContext.Provider value={{ currentUser, userProfile, logout, refreshUserProfile }}>
      {ready ? children : null}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
