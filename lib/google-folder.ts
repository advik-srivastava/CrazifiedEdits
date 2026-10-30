/** Extract a Google Drive folder ID from its standard share URL or a bare ID. */
export function googleFolderId(input: string): string {
  const raw = input.trim();
  let id = raw;
  if (/^https:\/\//i.test(raw)) {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error("Enter a valid Google Drive folder URL."); }
    if (url.hostname !== "drive.google.com") throw new Error("Use a Google Drive folder URL (drive.google.com).");
    const match = url.pathname.match(/\/folders\/([a-zA-Z0-9_-]{18,})(?:\/|$)/);
    if (!match) throw new Error("Copy the folder URL from Google Drive, not a file link.");
    id = match[1];
  }
  if (!/^[a-zA-Z0-9_-]{18,160}$/.test(id)) throw new Error("Enter a Google Drive folder URL or folder ID.");
  return id;
}
