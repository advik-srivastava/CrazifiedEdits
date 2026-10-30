/** ADMIN_EMAIL may hold one address or a comma-separated list of authorised editors. */
export function adminEmails(raw = process.env.ADMIN_EMAIL || ""): string[] {
  return raw.split(",").map(e => e.trim().toLowerCase()).filter(e => e.includes("@") && !e.startsWith("your_"));
}
export function isAdminEmail(email: string | null | undefined, raw?: string): boolean {
  return !!email && adminEmails(raw).includes(email.toLowerCase());
}
