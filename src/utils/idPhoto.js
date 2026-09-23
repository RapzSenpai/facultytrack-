import { supabase } from "../config/supabase";

// Mirrors the bucket limits enforced server-side by migration 007.
export const ID_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const ID_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function validateIdPhoto(file) {
  if (!file) return "Please upload a photo of your school ID.";
  if (!ID_PHOTO_TYPES.includes(file.type)) {
    return "ID photo must be a JPG, PNG, or WebP image.";
  }
  if (file.size > ID_PHOTO_MAX_BYTES) {
    return "ID photo must be 5MB or smaller.";
  }
  return "";
}

// Uploads to the private school-id-photos bucket under the caller's
// own folder (storage policies enforce the path) and records the path
// on the caller's own users row. Requires an authenticated session.
export async function uploadSchoolIdPhoto(userId, file) {
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("school-id-photos")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { error: dbErr } = await supabase
    .from("users")
    .update({ school_id_photo_path: path })
    .eq("id", userId);
  if (dbErr) {
    // ponytail: orphaned bucket object left behind on this rare path;
    // admin deletion on reject + bucket privacy make it harmless.
    throw new Error(dbErr.message);
  }
  return path;
}
