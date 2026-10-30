import "server-only";
import { serviceDb } from "./supabase";
import type { Connection, Payment, PublicSyncStatus, Reel, Settings, SyncEvent } from "./models";
import { adminLedgerReel, publicLedgerReel, publicReels, publicPayments } from "./public-ledger";
import { buildLedger, ledgerTotals, todayAndYesterday, todayInIndia } from "./billing";
import { unstable_noStore as noStore } from "next/cache";
import { getPublicClaims } from "./claims-server";

export async function getReels(): Promise<Reel[]> {
  noStore();
  const db = serviceDb();
  const records: Reel[] = [];
  for (let offset = 0; offset < 25000; offset += 500) {
    const { data, error } = await db.from("reels").select("*").order("first_seen_at", { ascending: false })
      .order("id", { ascending: true }).range(offset, offset + 499);
    if (error) throw new Error(`Unable to load reels: ${error.message}`);
    records.push(...((data || []) as Reel[]));
    if (!data || data.length < 500) break;
  }
  return records;
}
export async function getPayments(): Promise<Payment[]> {
  noStore();
  const db = serviceDb();
  const records: Payment[] = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const { data, error } = await db.from("payments").select("*").order("paid_on", { ascending: false })
      .order("id", { ascending: true }).range(offset, offset + 499);
    if (error) throw new Error(`Unable to load payments: ${error.message}`);
    records.push(...((data || []) as Payment[]));
    if (!data || data.length < 500) break;
  }
  return records;
}
export async function getSettings(): Promise<Settings> {
  noStore();
  const { data, error } = await serviceDb().from("app_settings").select("*").eq("id", 1).single();
  if (error) throw new Error(`Settings unavailable: ${error.message}`);
  return data as Settings;
}
export async function getConnection(): Promise<Connection | null> {
  noStore();
  const { data, error } = await serviceDb().from("google_drive_connection").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(`Google Drive connection unavailable (run the SQL migrations): ${error.message}`);
  return data as Connection | null;
}
/** Recent sync audit log. Returns [] when the V1.3 migration has not been run yet. */
export async function getSyncEvents(limit = 12): Promise<SyncEvent[]> {
  noStore();
  const { data, error } = await serviceDb().from("sync_events").select("*").order("started_at", { ascending: false }).limit(limit);
  return error ? [] : (data as SyncEvent[]);
}
function syncStatus(settings: Settings | null): PublicSyncStatus {
  return { lastSyncedAt: settings?.last_sync_at ?? null, healthy: !settings?.last_sync_error };
}

export async function getDashboard() {
  const [reels, payments, claims] = await Promise.all([getReels(), getPayments(), getPublicClaims()]);
  const ledgerReels = reels.filter(r => r.delivery_date).map(adminLedgerReel);
  const weeks = buildLedger(ledgerReels, payments, todayInIndia(), claims);
  return { reels, payments, weeks, totals: ledgerTotals(weeks), daily: todayAndYesterday(reels, adminLedgerReel) };
}

/** Public, read-only projection: never serialize admin notes, internal IDs, tokens, payment references or connection settings. */
export async function getPublicDashboard() {
  const [reels, payments, settings, claims] = await Promise.all([getReels(), getPayments(), getSettings().catch(() => null), getPublicClaims()]);
  const sharedReels = publicReels(reels);
  const weeks = buildLedger(sharedReels, publicPayments(payments), todayInIndia(), claims);
  const daily = todayAndYesterday(reels, publicLedgerReel);
  return { reels: sharedReels, weeks, totals: ledgerTotals(weeks), daily, sync: syncStatus(settings) };
}
