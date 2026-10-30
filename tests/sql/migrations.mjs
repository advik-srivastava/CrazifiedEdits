// Runs every SQL migration against a throwaway local Postgres and checks data safety.
// cd tests/sql && npm install && npm test     (Postgres refuses to run as root; use a normal user.)
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../sql") + "/";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crazified-pg-"));
fs.rmSync(dir, { recursive: true, force: true });
const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "pw", port: 54329, persistent: false });
await server.initialise(); await server.start();
const c = new pg.Client({ host: "localhost", port: 54329, user: "postgres", password: "pw", database: "postgres" });
await c.connect();
const q = (s, p) => c.query(s, p);
let fails = 0;
const ok = (cond, msg) => { console.log(cond ? "PASS" : "FAIL", msg); if (!cond) fails++; };
try {
  await q("CREATE ROLE anon; CREATE ROLE authenticated;");
  await q(fs.readFileSync(repo + "schema.sql", "utf8"));
  await q(fs.readFileSync(repo + "migrate_v1_2_google_drive.sql", "utf8"));
  // Legacy data as a V1.2 install would have it.
  await q(`INSERT INTO reels (id,drive_item_id,title,duration_seconds,status,delivery_date,notes) VALUES
    ('00000000-0000-0000-0000-000000000001','f1','Mon reel',45,'delivered','2026-10-26','private'),
    ('00000000-0000-0000-0000-000000000002','f2','Sun reel',60,'approved','2026-11-01',null),
    ('00000000-0000-0000-0000-000000000003','f3','Pending',30,'discovered',null,null),
    ('00000000-0000-0000-0000-000000000004',null,'Year edge',50,'delivered','2026-12-31',null)`);
  await q(`INSERT INTO payments (week_ending,amount,paid_on,note) VALUES ('2026-11-01',900,'2026-11-02','UPI 123')`);
  const before = (await q("SELECT id,title,status,delivery_date,duration_seconds,notes FROM reels ORDER BY id")).rows;
  const payBefore = (await q("SELECT week_ending,amount,paid_on,note FROM payments")).rows;

  await q(fs.readFileSync(repo + "migrate_v1_3.sql", "utf8"));
  await q(fs.readFileSync(repo + "migrate_v1_3.sql", "utf8")); // re-run must be safe
  ok(true, "migrate_v1_3.sql applies twice without error");

  const after = (await q("SELECT id,title,status,delivery_date,duration_seconds,notes FROM reels ORDER BY id")).rows;
  ok(JSON.stringify(after) === JSON.stringify(before), "existing reel data unchanged");
  ok(JSON.stringify((await q("SELECT week_ending,amount,paid_on,note FROM payments")).rows) === JSON.stringify(payBefore), "existing payments unchanged");

  const wk = Object.fromEntries((await q("SELECT title, to_char(billing_week_ending,'YYYY-MM-DD') w FROM reels")).rows.map(r => [r.title, r.w]));
  ok(wk["Mon reel"] === "2026-11-01", `backfill Monday -> Sunday (${wk["Mon reel"]})`);
  ok(wk["Sun reel"] === "2026-11-01", `backfill Sunday stays (${wk["Sun reel"]})`);
  ok(wk["Pending"] === null, "no delivery date -> no billing week");
  ok(wk["Year edge"] === "2027-01-03", `week crosses year boundary (${wk["Year edge"]})`);

  await q("UPDATE reels SET delivery_date='2030-12-30', status='delivered' WHERE title='Pending'");
  ok((await q("SELECT to_char(billing_week_ending,'YYYY-MM-DD') w FROM reels WHERE title='Pending'")).rows[0].w === "2031-01-05", "trigger sets week on update (last 2030 week)");
  await q("INSERT INTO reels (title,status,delivery_date) VALUES ('New','delivered','2028-02-29')");
  ok((await q("SELECT to_char(billing_week_ending,'YYYY-MM-DD') w FROM reels WHERE title='New'")).rows[0].w === "2028-03-05", "trigger sets week on insert (leap day)");

  // Duplicate Drive file IDs are impossible.
  let dup = false; try { await q("INSERT INTO reels (drive_item_id,title) VALUES ('f1','again')"); } catch { dup = true; }
  ok(dup, "unique drive_item_id rejects duplicate Drive file");
  // ON CONFLICT DO NOTHING path used by sync inserts.
  await q("INSERT INTO reels (drive_item_id,title,status) VALUES ('f1','race','discovered') ON CONFLICT (drive_item_id) DO NOTHING");
  ok((await q("SELECT status,title FROM reels WHERE drive_item_id='f1'")).rows[0].status === "delivered", "conflicting insert leaves delivered reel untouched");
  // Metadata-only upsert keeps status/delivery/notes.
  await q(`INSERT INTO reels (drive_item_id,title,drive_web_url,last_seen_at,drive_missing_at) VALUES ('f1','Renamed','https://drive.google.com/x',now(),null)
           ON CONFLICT (drive_item_id) DO UPDATE SET title=EXCLUDED.title, drive_web_url=EXCLUDED.drive_web_url, last_seen_at=EXCLUDED.last_seen_at, drive_missing_at=EXCLUDED.drive_missing_at`);
  const f1 = (await q("SELECT title,status,notes,to_char(delivery_date,'YYYY-MM-DD') d FROM reels WHERE drive_item_id='f1'")).rows[0];
  ok(f1.title === "Renamed" && f1.status === "delivered" && f1.notes === "private" && f1.d === "2026-10-26", "rename updates title only, billing fields kept");

  let bad = false; try { await q("INSERT INTO payments (week_ending,amount,paid_on) VALUES ('2026-11-02',100,'2026-11-02')"); } catch { bad = true; }
  ok(bad, "payment week must be a Sunday");
  let neg = false; try { await q("UPDATE reels SET confirmed_rate_inr=-5 WHERE title='New'"); } catch { neg = true; }
  ok(neg, "confirmed price must be positive");
  await q("UPDATE reels SET confirmed_rate_inr=1200 WHERE title='New'");
  await q("INSERT INTO sync_events (trigger,status) VALUES ('cron','running')");
  ok((await q("SELECT count(*)::int n FROM sync_events")).rows[0].n === 1, "sync_events insert works");
  const rls = (await q("SELECT relname FROM pg_class WHERE relname IN ('reels','payments','app_settings','google_drive_connection','sync_events') AND relrowsecurity")).rows.length;
  ok(rls === 5, `RLS enabled on all 5 tables (${rls})`);
  const pol = (await q("SELECT count(*)::int n FROM pg_policies WHERE schemaname='public'")).rows[0].n;
  ok(pol === 0, "no public RLS policies (server-only access)");
  // Lock claim used by acquireLock(): only one claimer wins.
  const claim = "UPDATE app_settings SET sync_lock_until=now()+interval '5 min' WHERE id=1 AND (sync_lock_until IS NULL OR sync_lock_until < now()) RETURNING id";
  const a = (await q(claim)).rowCount, b = (await q(claim)).rowCount;
  ok(a === 1 && b === 0, "sync lock: first claim wins, second is refused");

  // A fresh project path: schema.sql then migrate_v1_3.sql.
  await q("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await q(fs.readFileSync(repo + "schema.sql", "utf8"));
  await q(fs.readFileSync(repo + "migrate_v1_3.sql", "utf8"));
  ok(true, "fresh install: schema.sql + migrate_v1_3.sql apply cleanly");
} catch (e) { console.error("ERROR", e.message); fails++; }
finally { await c.end(); await server.stop(); }
console.log(fails ? `${fails} FAILED` : "ALL MIGRATION CHECKS PASSED");
process.exit(fails ? 1 : 0);
