import "server-only";
import { serviceDb } from "./supabase";
import type { Connection, Payment, Reel, Settings } from "./models";
import { publicReels, publicPayments } from "./public-ledger";
import { buildLedger, todayInIndia } from "./billing";
import { unstable_noStore as noStore } from "next/cache";

export async function getReels(): Promise<Reel[]> {
  noStore();
  const db=serviceDb();
  const records:Reel[]=[];
  for(let offset=0;offset<25000;offset+=500){
    const {data,error}=await db.from("reels").select("*").order("first_seen_at",{ascending:false})
      .order("id",{ascending:true}).range(offset,offset+499);
    if(error)throw new Error(`Unable to load reels: ${error.message}`);
    records.push(...((data||[]) as Reel[]));
    if(!data||data.length<500)break;
  }
  return records;
}
export async function getPayments(): Promise<Payment[]> {
  noStore();
  const db=serviceDb();
  const records:Payment[]=[];
  for(let offset=0;offset<20000;offset+=500){
    const {data,error}=await db.from("payments").select("*").order("paid_on",{ascending:false})
      .order("id",{ascending:true}).range(offset,offset+499);
    if(error)throw new Error(`Unable to load payments: ${error.message}`);
    records.push(...((data||[]) as Payment[]));
    if(!data||data.length<500)break;
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
  const { data, error } = await serviceDb().from("google_drive_connection").select("*").eq("id",1).maybeSingle();
  if (error) throw new Error(`Google Drive connection unavailable (run sql/migrate_v1_2_google_drive.sql): ${error.message}`);
  return data as Connection | null;
}
export async function getDashboard() {
  const [reels, payments] = await Promise.all([getReels(),getPayments()]);
  const weeks = buildLedger(reels, payments, todayInIndia());
  return { reels, payments, weeks, current: weeks[0] };
}

/** Public, read-only projection: never serialize admin notes, source IDs, tokens, or connection settings. */
export async function getPublicDashboard() {
  const [reels, payments] = await Promise.all([getReels(), getPayments()]);
  const sharedReels = publicReels(reels);
  const sharedPayments = publicPayments(payments);
  return { reels: sharedReels, weeks: buildLedger(sharedReels, sharedPayments, todayInIndia()) };
}
