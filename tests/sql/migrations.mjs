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

  const old = path.join(path.dirname(fileURLToPath(import.meta.url)), ".old_v13.sql");
  if (fs.existsSync(old)) { await q(fs.readFileSync(old, "utf8")); ok(true, "earlier V1.3 migration applied first (upgrade path)"); }
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
  await q("INSERT INTO sync_events (trigger,status) VALUES ('auto','success')");
  let badTrig = false; try { await q("INSERT INTO sync_events (trigger,status) VALUES ('bogus','success')"); } catch { badTrig = true; }
  ok(badTrig, "sync_events accepts manual/cron/auto only");
  const rls = (await q("SELECT relname FROM pg_class WHERE relname IN ('reels','payments','app_settings','google_drive_connection','sync_events') AND relrowsecurity")).rows.length;
  ok(rls === 5, `RLS enabled on all 5 tables (${rls})`);
  const pol = (await q("SELECT count(*)::int n FROM pg_policies WHERE schemaname='public'")).rows[0].n;
  ok(pol === 0, "no public RLS policies (server-only access)");
  // Lock claim used by acquireLock(): only one claimer wins.
  const claim = "UPDATE app_settings SET sync_lock_until=now()+interval '5 min' WHERE id=1 AND (sync_lock_until IS NULL OR sync_lock_until < now()) RETURNING id";
  const a = (await q(claim)).rowCount, b = (await q(claim)).rowCount;
  ok(a === 1 && b === 0, "sync lock: first claim wins, second is refused");

  // ---- V1.4
  const before14 = (await q("SELECT id,title,status,delivery_date,notes FROM reels ORDER BY id")).rows;
  await q(fs.readFileSync(repo + "migrate_v1_4.sql", "utf8"));
  await q(fs.readFileSync(repo + "migrate_v1_4.sql", "utf8"));
  ok(true, "migrate_v1_4.sql applies twice without error");
  ok(JSON.stringify((await q("SELECT id,title,status,delivery_date,notes FROM reels ORDER BY id")).rows) === JSON.stringify(before14), "V1.4 leaves existing reels unchanged");
  const st = (await q("SELECT auto_deliver, auto_remove, auto_deliver_since IS NOT NULL AS since FROM app_settings WHERE id=1")).rows[0];
  ok(st.auto_deliver === true && st.auto_remove === true && st.since === true, "automation on by default, starting from migration time");
  const rd = (await q("SELECT bool_or(auto_delivered) a, bool_or(removed_by_sync) r FROM reels")).rows[0];
  ok(rd.a === false && rd.r === false, "existing reels are not marked auto-delivered or removed");
  await q("INSERT INTO sync_events (trigger,status) VALUES ('webhook','success')");
  ok(true, "sync_events accepts 'webhook'");
  let badPrev = false; try { await q("UPDATE reels SET status_before_removal='bogus' WHERE title='New'"); } catch { badPrev = true; }
  ok(badPrev, "status_before_removal only accepts real statuses");
  await q("INSERT INTO payment_claims (week_ending,amount,paid_on,method,reference) VALUES ('2026-11-01',6000,'2026-10-31','UPI','4123')");
  ok((await q("SELECT status FROM payment_claims")).rows[0].status === "pending", "client report starts pending");
  const rej = async (sql) => { try { await q(sql); return false; } catch { return true; } };
  ok(await rej("INSERT INTO payment_claims (week_ending,amount,paid_on) VALUES ('2026-11-02',100,'2026-11-02')"), "report week must be a Sunday");
  ok(await rej("INSERT INTO payment_claims (week_ending,amount,paid_on) VALUES ('2026-11-01',0,'2026-11-01')"), "report amount must be positive");
  ok(await rej("INSERT INTO payment_claims (week_ending,amount,paid_on,status) VALUES ('2026-11-01',5,'2026-11-01','paid')"), "report status limited to pending/confirmed/rejected");
  const pid = (await q("INSERT INTO payments (week_ending,amount,paid_on) VALUES ('2026-11-01',6000,'2026-10-31') RETURNING id")).rows[0].id;
  await q("UPDATE payment_claims SET status='confirmed', payment_id=$1", [pid]);
  await q("DELETE FROM payments WHERE id=$1", [pid]);
  ok((await q("SELECT payment_id FROM payment_claims")).rows[0].payment_id === null, "deleting a payment keeps the report (link cleared)");
  ok((await q("SELECT relrowsecurity r FROM pg_class WHERE relname='payment_claims'")).rows[0].r === true, "payment_claims has RLS on");
  ok((await q("SELECT count(*)::int n FROM pg_policies WHERE tablename='payment_claims'")).rows[0].n === 0, "payment_claims has no public policies");

  // V1.4 deleted reels: column exists, auto-removed rows are backfilled as deleted, manual delete works.
  await q("UPDATE reels SET removed_by_sync=true, status='cancelled', status_before_removal='delivered', deleted_at=NULL WHERE title='New'");
  await q(fs.readFileSync(repo + "migrate_v1_4.sql", "utf8"));
  ok((await q("SELECT deleted_at IS NOT NULL d FROM reels WHERE title='New'")).rows[0].d === true, "previously auto-removed reels become deleted");
  await q("UPDATE reels SET deleted_at=now(), status='cancelled' WHERE drive_item_id='f1'");
  ok((await q("SELECT count(*)::int n FROM reels WHERE deleted_at IS NOT NULL")).rows[0].n === 2, "reels can be marked deleted");
  // V1.5 invoices.
  await q(fs.readFileSync(repo + "migrate_v1_5.sql", "utf8"));
  await q(fs.readFileSync(repo + "migrate_v1_5.sql", "utf8"));
  ok(true, "migrate_v1_5.sql applies twice without error");
  const inv = (await q(`INSERT INTO invoices (number,kind,period_start,period_end,issue_date,due_date,items,item_count,total)
    VALUES ('CE-2026-0001','weekly','2026-10-26','2026-11-01','2026-11-01','2026-11-08','[]',2,1200) RETURNING id`)).rows[0].id;
  let dupNum = false; try { await q(`INSERT INTO invoices (number,kind,period_start,period_end,issue_date,due_date,item_count,total) VALUES ('CE-2026-0001','daily','2026-11-02','2026-11-02','2026-11-02','2026-11-02',1,600)`); } catch { dupNum = true; }
  ok(dupNum, "invoice numbers are unique");
  let badWeek = false; try { await q(`INSERT INTO invoices (number,kind,period_start,period_end,issue_date,due_date,item_count,total) VALUES ('CE-2026-0002','weekly','2026-10-27','2026-11-02','2026-11-02','2026-11-02',1,600)`); } catch { badWeek = true; }
  ok(badWeek, "weekly invoice must run Monday to Sunday");
  let badDay = false; try { await q(`INSERT INTO invoices (number,kind,period_start,period_end,issue_date,due_date,item_count,total) VALUES ('CE-2026-0003','daily','2026-11-02','2026-11-03','2026-11-02','2026-11-02',1,600)`); } catch { badDay = true; }
  ok(badDay, "daily invoice covers exactly one day");
  let badFmt = false; try { await q(`INSERT INTO invoices (number,kind,period_start,period_end,issue_date,due_date,item_count,total) VALUES ('INV-1','daily','2026-11-02','2026-11-02','2026-11-02','2026-11-02',1,600)`); } catch { badFmt = true; }
  ok(badFmt, "invoice number format enforced");
  await q("INSERT INTO payments (week_ending,amount,paid_on,invoice_id) VALUES ('2026-11-01',600,'2026-11-03',$1)", [inv]);
  ok((await q("SELECT count(*)::int n FROM payments WHERE invoice_id=$1", [inv])).rows[0].n === 1, "payments can be linked to an invoice");
  await q("DELETE FROM invoices WHERE id=$1", [inv]);
  ok((await q("SELECT count(*)::int n FROM payments WHERE amount=600 AND paid_on='2026-11-03' AND invoice_id IS NULL")).rows[0].n === 1, "deleting an invoice never deletes payments");
  ok((await q("SELECT relrowsecurity r FROM pg_class WHERE relname='invoices'")).rows[0].r === true, "invoices has RLS on");
  ok((await q("SELECT invoice_profile::text p FROM app_settings WHERE id=1")).rows[0].p === "{}", "invoice details default to empty");
  // V1.6: CS-MS numbering, renumbering of old invoices, weekly replaces daily.
  await q(`INSERT INTO invoices (number,kind,period_start,period_end,issue_date,due_date,item_count,total,created_at) VALUES
    ('CE-2026-0001','daily','2026-10-31','2026-10-31','2026-10-31','2026-11-07',5,3000,'2026-10-31 10:00+05:30'),
    ('CE-2026-0002','daily','2026-11-02','2026-11-02','2026-11-02','2026-11-09',1,600,'2026-11-02 10:00+05:30')`);
  await q(fs.readFileSync(repo + "migrate_v1_6.sql", "utf8"));
  await q(fs.readFileSync(repo + "migrate_v1_6.sql", "utf8"));
  ok(true, "migrate_v1_6.sql applies twice without error");
  const nums = (await q("SELECT number FROM invoices ORDER BY created_at")).rows.map(r => r.number).join(",");
  ok(nums === "CS-MS-01,CS-MS-02", `old invoices renumbered in order (${nums})`);
  let oldFmt = 0;
  for (const bad of ["cs-ms-01", "CS-MS-1", "CS MS 01", "CSMS"]) { try { await q(`INSERT INTO invoices (number,kind,period_start,period_end,issue_date,due_date,item_count,total) VALUES ($1,'daily','2026-11-05','2026-11-05','2026-11-05','2026-11-05',1,600)`, [bad]); } catch { oldFmt++; } }
  oldFmt = oldFmt === 4;
  ok(oldFmt, "only PREFIX-NN numbers accepted now");
  const weeklyInv = (await q(`INSERT INTO invoices (number,kind,period_start,period_end,issue_date,due_date,item_count,total) VALUES ('CS-MS-03','weekly','2026-10-26','2026-11-01','2026-11-01','2026-11-08',6,3600) RETURNING id`)).rows[0].id;
  await q("UPDATE invoices SET status='void', voided_at=now(), superseded_by=$1 WHERE number='CS-MS-01'", [weeklyInv]);
  ok((await q("SELECT superseded_by=$1 r FROM invoices WHERE number='CS-MS-01'", [weeklyInv])).rows[0].r === true, "a daily invoice can point to the weekly invoice that replaced it");
  // V1.7: billing week override and revisions.
  await q(fs.readFileSync(repo + "migrate_v1_7.sql", "utf8"));
  await q(fs.readFileSync(repo + "migrate_v1_7.sql", "utf8"));
  ok(true, "migrate_v1_7.sql applies twice without error");
  const r7 = (await q("INSERT INTO reels (title,status,delivery_date) VALUES ('Monday changes','delivered','2026-11-02') RETURNING id, to_char(billing_week_ending,'YYYY-MM-DD') w")).rows[0];
  ok(r7.w === "2026-11-08", `delivery week by default (${r7.w})`);
  await q("UPDATE reels SET billing_week_override='2026-11-01' WHERE id=$1", [r7.id]);
  ok((await q("SELECT to_char(billing_week_ending,'YYYY-MM-DD') w FROM reels WHERE id=$1", [r7.id])).rows[0].w === "2026-11-01", "override moves the billing week");
  await q("UPDATE reels SET billing_week_override=NULL WHERE id=$1", [r7.id]);
  ok((await q("SELECT to_char(billing_week_ending,'YYYY-MM-DD') w FROM reels WHERE id=$1", [r7.id])).rows[0].w === "2026-11-08", "clearing the override restores the delivery week");
  let notSunday = false; try { await q("UPDATE reels SET billing_week_override='2026-11-02' WHERE id=$1", [r7.id]); } catch { notSunday = true; }
  ok(notSunday, "override must be a Sunday");
  let selfRev = false; try { await q("UPDATE reels SET revision_of=id WHERE id=$1", [r7.id]); } catch { selfRev = true; }
  ok(selfRev, "a reel can't be a revision of itself");
  const orig = (await q("INSERT INTO reels (title,status,delivery_date) VALUES ('Original','delivered','2026-11-01') RETURNING id")).rows[0].id;
  await q("UPDATE reels SET revision_of=$2 WHERE id=$1", [r7.id, orig]);
  await q("DELETE FROM reels WHERE id=$1", [orig]);
  ok((await q("SELECT revision_of FROM reels WHERE id=$1", [r7.id])).rows[0].revision_of === null, "deleting the original clears the link, keeps the revision");
  // A fresh project path: schema.sql then migrate_v1_3.sql.
  await q("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await q(fs.readFileSync(repo + "schema.sql", "utf8"));
  await q(fs.readFileSync(repo + "migrate_v1_3.sql", "utf8"));
  await q(fs.readFileSync(repo + "migrate_v1_4.sql", "utf8"));
  await q(fs.readFileSync(repo + "migrate_v1_5.sql", "utf8"));
  await q(fs.readFileSync(repo + "migrate_v1_6.sql", "utf8"));
  await q(fs.readFileSync(repo + "migrate_v1_7.sql", "utf8"));
  ok(true, "fresh install: schema.sql + migrate_v1_3 … v1_7 apply cleanly");
} catch (e) { console.error("ERROR", e.message); fails++; }
finally { await c.end(); await server.stop(); }
console.log(fails ? `${fails} FAILED` : "ALL MIGRATION CHECKS PASSED");
process.exit(fails ? 1 : 0);
