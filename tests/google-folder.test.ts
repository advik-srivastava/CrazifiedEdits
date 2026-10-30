import assert from "node:assert/strict";
import test from "node:test";
import {googleFolderId} from "../lib/google-folder";

test("accepts Google Drive folder links and bare IDs",()=>{
  const id="1aBcDeFgHijklmnOPQrSTuV2";
  assert.equal(googleFolderId(id),id);
  assert.equal(googleFolderId(`https://drive.google.com/drive/folders/${id}?usp=sharing`),id);
  assert.equal(googleFolderId(`https://drive.google.com/drive/u/0/folders/${id}`),id);
});
test("rejects file links, fake hosts and unsafe folder values",()=>{
  assert.throws(()=>googleFolderId("Client-Reels"));
  assert.throws(()=>googleFolderId("https://drive.google.com/file/d/1aBcDeFgHijklmnOPQrSTuV2/view"));
  assert.throws(()=>googleFolderId("https://drive.google.com.evil.test/drive/folders/1aBcDeFgHijklmnOPQrSTuV2"));
  assert.throws(()=>googleFolderId("/../../myfolder"));
});
