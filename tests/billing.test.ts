import assert from "node:assert/strict";
import test from "node:test";
import { billable, buildLedger, mondayFor, sundayFor, reelFee, shiftISODate, RATE_INR, billingCalendar } from "../lib/billing";
import type { Reel, Payment } from "../lib/models";
const r=(patch:Partial<Reel>={}):Reel=>({id:"r1",drive_item_id:null,drive_id:null,source:"manual",title:"Reel",drive_web_url:null,client_url:null,duration_seconds:60,status:"delivered",delivery_date:"2026-10-30",notes:null,first_seen_at:"2026-10-30T00:00:00Z",last_seen_at:null,updated_at:"2026-10-30T00:00:00Z",...patch});
test("Monday through Sunday share the same week ending",()=>{
  assert.equal(sundayFor("2026-10-26"),"2026-11-01");
  assert.equal(sundayFor("2026-10-30"),"2026-11-01");
  assert.equal(sundayFor("2026-11-01"),"2026-11-01");
  assert.equal(sundayFor("2026-11-02"),"2026-11-08");
  assert.equal(mondayFor("2026-11-01"),"2026-10-26");
});
test("fixed 600 billed only for delivered duration <= 60",()=>{
  assert.equal(reelFee(r()),600);
  assert.equal(reelFee(r({duration_seconds:61})),0);
  assert.equal(reelFee(r({duration_seconds:null})),0);
  assert.equal(reelFee(r({status:"discovered"})),0);
  assert.equal(reelFee(r({status:"cancelled"})),0);
  assert.equal(reelFee(r({status:"revision"})),600);
  assert.equal(reelFee(r({delivery_date:null})),0);
});
test("Sunday settlement subtracts partial payments",()=>{
  const reels=[r(),r({id:"r2",delivery_date:"2026-11-01"}),r({id:"r3",delivery_date:"2026-11-02"})];
  const payments:Payment[]=[{id:"p1",week_ending:"2026-11-01",amount:500,paid_on:"2026-11-03",note:null}];
  const weeks=buildLedger(reels,payments,"2026-10-30");
  const first=weeks.find(w=>w.ending==="2026-11-01")!;
  assert.equal(first.count,2);assert.equal(first.billed,1200);assert.equal(first.received,500);assert.equal(first.due,700);
  assert.equal(weeks.find(w=>w.ending==="2026-11-08")?.billed,600);
});
test("date rollovers are UTC-safe",()=>{assert.equal(shiftISODate("2026-12-31",1),"2027-01-01");assert.equal(shiftISODate("2026-01-01",-1),"2025-12-31");assert.throws(()=>shiftISODate("2026-02-30",1));});
test("the weekly log includes delivered but unbilled overlength files",()=>{
  const weeks=buildLedger([r({id:"long",duration_seconds:90})],[],"2026-10-30");
  const w=weeks.find(x=>x.ending==="2026-11-01")!;
  assert.equal(w.reels.length,1);
  assert.equal(w.billed,0);
  assert.equal(w.count,0);
});

test("billing calendar contains uninterrupted weeks through December 2030", () => {
  const weeks = billingCalendar();
  assert.equal(weeks[0].starting,"2025-12-29");
  assert.equal(weeks[0].ending,"2026-01-04");
  assert.equal(weeks.at(-1)?.starting,"2030-12-30");
  assert.equal(weeks.at(-1)?.ending,"2031-01-05");
  assert.ok(weeks.length>=260);
  for(let i=1;i<weeks.length;i++)assert.equal(weeks[i].starting,shiftISODate(weeks[i-1].starting,7));
});
test("pre-created empty billing weeks can be selected and carry no charges", () => {
  const all=buildLedger([],[],"2026-10-30");
  const future=all.find(w=>w.ending==="2029-11-04");
  assert.ok(future);
  assert.equal(future!.billed,0);
  assert.equal(future!.received,0);
  assert.equal(future!.reels.length,0);
});
