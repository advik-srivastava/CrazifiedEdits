import "server-only";
import { redirect } from "next/navigation";
import { userDb } from "./supabase";
import { isAdminEmail } from "./admin-emails";

async function sessionUser() {
  const client = await userDb();
  const { data: { user }, error } = await client.auth.getUser();
  return error ? null : user;
}
export async function adminUser() {
  const user = await sessionUser();
  return user && isAdminEmail(user.email) ? user : null;
}
/** Server-side gate for every admin page and action. Hiding buttons is never the protection. */
export async function requireAdmin() {
  const user = await sessionUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) {
    await (await userDb()).auth.signOut().catch(() => undefined);
    redirect("/login?denied=1");
  }
  return user;
}
export async function assertAdminApi(): Promise<boolean> {
  try { return !!(await adminUser()); }
  catch { return false; }
}
