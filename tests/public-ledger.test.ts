import assert from "node:assert/strict";
import test from "node:test";
import { publicReels, publicPayments } from "../lib/public-ledger";
import type { Payment, Reel } from "../lib/models";

const base: Reel = {
  id: "sample-id", drive_item_id: "private-drive-id", drive_id: "internal-drive",
  source: "onedrive", title: "Mohit Reel #01", drive_web_url: "https://onedrive.live.com/item",
  client_url: "https://1drv.ms/u/s!sample", duration_seconds: 46, status: "delivered",
  delivery_date: "2026-10-30", notes: "Private note: do not reveal", first_seen_at: "2026-10-29T00:00:00Z",
  last_seen_at: null, updated_at: "2026-10-30T00:00:00Z"
};
test("public ledger exposes delivered reels but not drafts or cancellations", () => {
  const result = publicReels([base,{...base,id:"unapproved",status:"discovered"},{...base,id:"cancelled",status:"cancelled"}]);
  assert.equal(result.length,1);
  assert.equal(result[0].title,"Mohit Reel #01");
});
test("public ledger does not serialize admin notes or OneDrive item identifiers", () => {
  const [item] = publicReels([base]);
  const json = JSON.stringify(item);
  assert.doesNotMatch(json,/private-drive-id|internal-drive|Private note|first_seen_at|updated_at/);
  assert.equal(item.client_url,base.client_url);
  assert.equal(item.drive_web_url,null);
});
test("public payments expose settlement fields only", () => {
  const payments: Payment[] = [{id:"p",week_ending:"2026-11-01",amount:600,paid_on:"2026-11-01",note:"UPI transfer"}];
  assert.equal(publicPayments(payments)[0].amount,600);
  assert.equal(publicPayments(payments)[0].note,null);
});
