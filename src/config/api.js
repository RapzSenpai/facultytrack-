export const API = import.meta.env.PROD ? "" : (import.meta.env.VITE_API_URL || "http://localhost:5000");

const PUBLIC_PATHS = [
  "/register-user",
  "/verify-email",
  "/resend-code",
  "/lookup-email",
  "/check-email",
  "/send-password-reset",
];

export async function apiFetch(url, options = {}) {
  return fetch(url, options);
}
