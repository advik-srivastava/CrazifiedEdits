import "server-only";
import { redirect } from "next/navigation";
import { userDb } from "./supabase";

export async function adminUser() {
  const client = await userDb();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user || !user.email || !process.env.ADMIN_EMAIL || user.email.toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase()) return null;
  return user;
}
export async function requireAdmin() {
  const user = await adminUser();
  if (!user) redirect("/login");
  return user;
}
export async function assertAdminApi(): Promise<boolean> {
  try { return !!(await adminUser()); }
  catch { return false; }
}
