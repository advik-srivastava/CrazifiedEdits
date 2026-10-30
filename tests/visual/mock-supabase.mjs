// TEST-ONLY mock of the Supabase REST + Auth API, used to render CrazifiedEdits locally
// with sample data for layout and mobile checks. It is never used in production and
// writes nothing anywhere. Run:  node tests/visual/mock-supabase.mjs   (listens on :54321)
// then start Next with the env printed below.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 54321);
const ADMIN = "admin@example.test";
const DAY = 86_400_000;
const istDate = (t) => new Date(t + 5.5 * 3_600_000).toISOString().slice(0, 10);
const now = Date.now();
const today = istDate(now);
const d = (offset) => istDate(now + offset * DAY);
// Monday of the current IST week.
const dow = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
const mon = (weeksBack) => istDate(Date.parse(`${today}T06:30:00Z`) - (dow - 1) * DAY - weeksBack * 7 * DAY);
const sun = (weeksBack) => istDate(Date.parse(`${mon(weeksBack)}T06:30:00Z`) + 6 * DAY);
const iso = (date, hh = 10) => new Date(`${date}T${String(hh).padStart(2, "0")}:00:00+05:30`).toISOString();

let n = 0;
const reel = (title, status, delivery, duration, upload, extra = {}) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, drive_item_id: `sampleDriveFile${String(n).padStart(8, "0")}`,
  drive_id: null, source: "google_drive", title, drive_web_url: `https://drive.google.com/file/d/sample${n}/view`, client_url: null,
  duration_seconds: duration, status, delivery_date: delivery, notes: n % 3 ? null : "Sample private note",
  first_seen_at: iso(upload, 9), last_seen_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
  mime_type: "video/mp4", drive_created_at: iso(upload, 9), drive_modified_at: iso(upload, 9), drive_missing_at: null,
  revision_count: 0, confirmed_rate_inr: null, billing_week_ending: null, ...extra
});
const reels = [
  reel("Morning routine that fixed my gut — hook v2.mp4", "discovered", null, 48, today),
  reel("Copy of 5 protein breakfasts under ₹100.mp4", "discovered", null, 55, today),
  reel("Why I quit sugar for 30 days (long cut).mov", "discovered", null, 92, d(-1)),
  reel("5 protein breakfasts under ₹100.mp4", "delivered", today, 57, d(-1)),
  reel("Gym bag essentials.mp4", "approved", today, 41, today),
  reel("Street food tour — Old Delhi part 1 with a deliberately very long title to test wrapping on small phones.mp4", "delivered", d(-1), 59, d(-2)),
  reel("Budget meal prep Sunday.mp4", "delivered", d(-1), 60, d(-1)),
  reel("Podcast clip — sleep & recovery.mp4", "delivered", d(-1), 118, d(-2)),
  reel("Hydration myths.mp4", "revision", mon(0), 38, mon(0)),
  reel("Desk stretches for creators.mp4", "delivered", mon(0), 44, mon(0)),
  reel("Mini vlog: shoot day BTS.mp4", "delivered", mon(0), 75, mon(0), { confirmed_rate_inr: "900.00" }),
  ...Array.from({ length: 9 }, (_, i) => reel(`Weekly reel ${i + 1} — fitness series.mp4`, "approved", istDate(Date.parse(`${mon(1)}T06:30:00Z`) + (i % 7) * DAY), 30 + i * 3, mon(1))),
  ...Array.from({ length: 6 }, (_, i) => reel(`Recipe short ${i + 1}.mp4`, "delivered", istDate(Date.parse(`${mon(2)}T06:30:00Z`) + (i % 7) * DAY), 50, mon(2))),
  reel("Cancelled test upload.mp4", "cancelled", null, 20, d(-3)),
  { ...reel("Old manual entry.mp4", "delivered", mon(3), 52, mon(3)), source: "manual", drive_item_id: null }
];
const payments = [
  { id: "10000000-0000-4000-8000-000000000001", week_ending: sun(1), amount: 3000, paid_on: sun(1), note: "UPI ref 4411", method: "UPI", created_at: iso(sun(1)) },
  { id: "10000000-0000-4000-8000-000000000002", week_ending: sun(1), amount: 2400, paid_on: d(-2), note: null, method: "Bank transfer", created_at: iso(d(-2)) },
  { id: "10000000-0000-4000-8000-000000000003", week_ending: sun(2), amount: 3600, paid_on: sun(2), note: null, method: "UPI", created_at: iso(sun(2)) },
  { id: "10000000-0000-4000-8000-000000000004", week_ending: sun(3), amount: 600, paid_on: sun(3), note: null, method: null, created_at: iso(sun(3)) }
];
const settings = { id: 1, folder_path: "1AbCdEfGhIjKlMnOpQrStUvWx", last_sync_at: new Date(now - 7 * 60_000).toISOString(), last_sync_count: 27, last_sync_error: null, sync_lock_until: null, last_sync_started_at: null };
const connection = { id: 1, account_email: "studio@example.test", account_name: "Crazified Studios", refresh_token_ciphertext: "x.y.z", connected_at: iso(d(-20)), connected_by: ADMIN };
const events = [
  { id: 3, trigger: "cron", status: "success", started_at: new Date(now - 7 * 60_000).toISOString(), finished_at: null, scanned: 27, imported: 2, updated: 25, missing: 0, error: null },
  { id: 2, trigger: "manual", status: "skipped", started_at: new Date(now - 20 * 60_000).toISOString(), finished_at: null, scanned: 0, imported: 0, updated: 0, missing: 0, error: "Another sync was already running." },
  { id: 1, trigger: "cron", status: "error", started_at: new Date(now - 22 * 60_000).toISOString(), finished_at: null, scanned: 12, imported: 0, updated: 12, missing: 0, error: "Google Drive is rate-limiting requests right now." }
];
// 2x2 PNG used as a sample payment screenshot.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==", "base64");
const claims = [
  { id: "20000000-0000-4000-8000-000000000001", week_ending: sun(1), amount: 3000, paid_on: d(-1), method: "UPI", reference: "UPI 4123 5678 9012", note: "Balance for last week", screenshot_path: "2026/sample.png", status: "pending", payment_id: null, review_note: null, submitter_hash: "x", submitted_at: iso(d(-1), 18), reviewed_at: null },
  { id: "20000000-0000-4000-8000-000000000002", week_ending: sun(0), amount: 1200, paid_on: today, method: "UPI", reference: null, note: null, screenshot_path: null, status: "pending", payment_id: null, review_note: null, submitter_hash: "y", submitted_at: iso(today, 9), reviewed_at: null }
];
export const received = [];
const tables = { reels, payments, sync_events: events, payment_claims: claims };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
export const ACCESS_TOKEN = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "admin-user", email: ADMIN, role: "authenticated", aud: "authenticated", exp: Math.floor(now / 1000) + 86400 })}.sig`;
const user = { id: "admin-user", aud: "authenticated", role: "authenticated", email: ADMIN, app_metadata: {}, user_metadata: {}, created_at: iso(d(-30)) };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json", "content-range": "0-*/*" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
  if (url.pathname === "/auth/v1/user") return (req.headers.authorization === `Bearer ${ACCESS_TOKEN}`) ? send(200, user) : send(401, { msg: "invalid" });
  if (url.pathname.startsWith("/auth/v1/")) return send(200, { keys: [] });
  if (url.pathname.startsWith("/storage/v1/object/sign/")) return send(200, [{ path: "2026/sample.png", signedURL: "/object/public-sample/sample.png?token=t", error: null }]);
  if (url.pathname.startsWith("/storage/v1/object/public-sample/")) { res.writeHead(200, { "content-type": "image/png" }); return res.end(PNG); }
  if (url.pathname.startsWith("/storage/v1/object/")) {
    let n = 0; req.on("data", c => n += c.length); req.on("end", () => { console.log(`UPLOAD ${url.pathname} ${req.headers["content-type"]} ${n} bytes`); send(200, { Key: url.pathname }); }); return;
  }
  const table = url.pathname.replace("/rest/v1/", "");
  if (req.method !== "GET" && req.method !== "HEAD") { // writes are logged and ignored
    let body = ""; req.on("data", c => body += c); req.on("end", () => { console.log(`WRITE ${req.method} ${table} ${body.slice(0, 300)}`); send(200, []); }); return;
  }
  if (req.method === "HEAD") { res.writeHead(200, { "content-range": "*/0" }); return res.end(); }
  const single = (req.headers.accept || "").includes("vnd.pgrst.object");
  if (table === "app_settings") return send(200, single ? settings : [settings]);
  if (table === "google_drive_connection") return send(200, single ? connection : [connection]);
  if (tables[table]) {
    const offset = Number(url.searchParams.get("offset") || 0);
    return send(200, offset ? [] : tables[table]);
  }
  send(404, { message: "unknown table" });
}).listen(PORT, () => {
  const session = { access_token: ACCESS_TOKEN, refresh_token: "r", token_type: "bearer", expires_in: 86400, expires_at: Math.floor(now / 1000) + 86400, user };
  console.log(`mock supabase on :${PORT}`);
  console.log(`ADMIN_COOKIE=sb-localhost-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`);
});
