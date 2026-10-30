import "server-only";
import { decryptToken, encryptToken } from "./secure";
import { getConnection, getSettings } from "./data";
import { serviceDb } from "./supabase";
import { googleFolderId } from "./google-folder";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const PROFILE_API = "https://www.googleapis.com/oauth2/v3/userinfo";
const SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly openid email profile";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;

type GoogleToken = {access_token?:string;refresh_token?:string;error?:string};
type DriveItem = {id:string;name:string;mimeType:string;webViewLink?:string;videoMediaMetadata?:{durationMillis?:string};modifiedTime?:string};
type ListResponse = {files?:DriveItem[];nextPageToken?:string;incompleteSearch?:boolean};
type Profile = {name?:string;email?:string};

export function googleConfig() {
  const id=process.env.GOOGLE_CLIENT_ID?.trim(),secret=process.env.GOOGLE_CLIENT_SECRET?.trim(),redirect=process.env.GOOGLE_REDIRECT_URI?.trim();
  if(!id||!secret||!redirect||id.startsWith("YOUR_")||secret.startsWith("YOUR_"))throw new Error("Google Drive OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI in .env.local.");
  if(!/^https:\/\//.test(redirect) && !/^http:\/\/localhost(?::\d+)?\//.test(redirect))throw new Error("Google redirect URI must use HTTPS or localhost.");
  return {id,secret,redirect};
}
export function googleAuthorizeUrl(state:string,challenge:string) {
  const c=googleConfig();
  const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for(const [key,value] of Object.entries({client_id:c.id,redirect_uri:c.redirect,response_type:"code",scope:SCOPE,
    access_type:"offline",prompt:"consent select_account",state,code_challenge:challenge,code_challenge_method:"S256"}))url.searchParams.set(key,value);
  return url.toString();
}
async function tokenRequest(fields:Record<string,string>):Promise<GoogleToken> {
  const c=googleConfig();
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_id:c.id,client_secret:c.secret,...fields}),cache:"no-store"});
  const data=await response.json() as GoogleToken;
  if(!response.ok||!data.access_token)throw new Error(`Google authorization failed (${data.error||response.status}). Reconnect Google Drive in admin.`);
  return data;
}
export async function exchangeGoogleCode(code:string,verifier:string){
  return tokenRequest({grant_type:"authorization_code",code,code_verifier:verifier,redirect_uri:googleConfig().redirect});
}
async function googleGet<T>(token:string,url:URL):Promise<T> {
  if(url.protocol!=="https:"|| !["www.googleapis.com"].includes(url.hostname) ||
     !(url.pathname==="/drive/v3/files"||/^\/drive\/v3\/files\/[a-zA-Z0-9_-]{18,160}$/.test(url.pathname)||url.pathname==="/oauth2/v3/userinfo"))throw new Error("Unexpected Google API endpoint.");
  const response=await fetch(url.toString(),{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},cache:"no-store"});
  if(!response.ok)throw new Error(`Google Drive returned HTTP ${response.status}. ${response.status===403?"Check Drive API permissions and consent.":response.status===404?"Check the selected folder access.":"Try reconnecting your account."}`);
  return response.json() as Promise<T>;
}
export async function storeGoogleConnection(refreshToken:string,accessToken:string) {
  const profile=await googleGet<Profile>(accessToken,new URL(PROFILE_API));
  const {error}=await serviceDb().from("google_drive_connection").upsert({id:1,
    account_email:profile.email||null,account_name:profile.name||null,
    refresh_token_ciphertext:encryptToken(refreshToken),connected_at:new Date().toISOString()});
  if(error)throw new Error("Could not store Google Drive connection. Run the V1.2 SQL migration first.");
}
async function currentAccessToken():Promise<string>{
  const connection=await getConnection();
  if(!connection)throw new Error("Connect your Google Drive account first.");
  const refreshed=await tokenRequest({grant_type:"refresh_token",refresh_token:decryptToken(connection.refresh_token_ciphertext)});
  if(refreshed.refresh_token){
    const {error}=await serviceDb().from("google_drive_connection").update({refresh_token_ciphertext:encryptToken(refreshed.refresh_token)})
      .eq("id",1).eq("refresh_token_ciphertext",connection.refresh_token_ciphertext);
    if(error)throw new Error("Could not save the renewed Google token.");
  }
  return refreshed.access_token!;
}
export type SyncResult={scanned:number;imported:number;updated:number;folder:string};
export async function syncGoogleDrive():Promise<SyncResult>{
  const settings=await getSettings();
  const folder=googleFolderId(settings.folder_path);
  const token=await currentAccessToken();
  const db=serviceDb();
  const folderInfo=new URL(`${DRIVE_API}/${encodeURIComponent(folder)}`);
  folderInfo.searchParams.set("fields","id,name,mimeType");
  folderInfo.searchParams.set("supportsAllDrives","true");
  const folderMetadata=await googleGet<DriveItem>(token,folderInfo);
  if(folderMetadata.mimeType!==FOLDER_MIME)throw new Error("The selected Google Drive link is not a folder.");
  let scanned=0,imported=0,updated=0,requests=0;
  const pending=[folder],visited=new Set<string>();
  let buffer:DriveItem[]=[];
  // Bulk upserts keep sync usable for several years of video files.
  async function flush(){
    if(!buffer.length)return;
    const list=buffer; buffer=[];
    const ids=[...new Set(list.map(item=>item.id))];
    const {data:existing,error:lookupError}=await db.from("reels")
      .select("drive_item_id,status,delivery_date,notes,client_url,first_seen_at,duration_seconds")
      .in("drive_item_id",ids);
    if(lookupError)throw new Error("Could not look up existing Google Drive files. Check your Supabase connection.");
    const found=new Map((existing||[]).map(row=>[row.drive_item_id,row]));
    const now=new Date().toISOString();
    const rows=ids.map(id=>{
      const item=list.find(file=>file.id===id)!;
      const old=found.get(id);
      const millis=Number(item.videoMediaMetadata?.durationMillis);
      const duration=Number.isFinite(millis)&&millis>0?Math.ceil(millis/1000):null;
      const url=item.webViewLink||`https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
      return {drive_item_id:id,source:"google_drive" as const,title:item.name.slice(0,250),
        drive_id:null,drive_web_url:url,client_url:old?.client_url??null,
        duration_seconds:old?.duration_seconds??duration,
        status:old?.status??"discovered",delivery_date:old?.delivery_date??null,notes:old?.notes??null,
        first_seen_at:old?.first_seen_at??now,last_seen_at:now,updated_at:now};
    });
    const {error}=await db.from("reels").upsert(rows,{onConflict:"drive_item_id"});
    if(error)throw new Error("Could not save synced Google Drive files. Check the V1.2 SQL migration.");
    imported+=ids.filter(id=>!found.has(id)).length;
    updated+=ids.filter(id=>found.has(id)).length;
  }
  try {
    while(pending.length){
      const parent=pending.shift()!;
      if(visited.has(parent))continue;
      visited.add(parent);
      if(visited.size>120)throw new Error("Folder tree is too large; use a smaller Google Drive folder.");
      let pageToken:string|undefined;
      do {
        if(++requests>120)throw new Error("Drive sync request limit reached; use a smaller folder.");
        const url=new URL(DRIVE_API);
        url.searchParams.set("q",`'${parent}' in parents and trashed = false`);
        url.searchParams.set("pageSize","200");
        url.searchParams.set("fields","nextPageToken,incompleteSearch,files(id,name,mimeType,webViewLink,videoMediaMetadata(durationMillis),modifiedTime)");
        url.searchParams.set("supportsAllDrives","true");
        url.searchParams.set("includeItemsFromAllDrives","true");
        if(pageToken)url.searchParams.set("pageToken",pageToken);
        const response=await googleGet<ListResponse>(token,url);
        if(response.incompleteSearch)throw new Error("Google Drive search returned incomplete results. Narrow your folder.");
        for(const item of response.files||[]){
          if(item.mimeType===FOLDER_MIME){pending.push(item.id);continue;}
          if(!(item.mimeType?.startsWith("video/")||VIDEO_EXT.test(item.name)))continue;
          scanned++;
          if(scanned>10000)throw new Error("More than 10,000 videos; divide this folder into smaller collections.");
          buffer.push(item);
          if(buffer.length>=100)await flush();
        }
        pageToken=response.nextPageToken;
      }while(pageToken);
    }
    await flush();
    const {error}=await db.from("app_settings").update({last_sync_at:new Date().toISOString(),last_sync_count:scanned,last_sync_error:null}).eq("id",1);
    if(error)throw new Error("Could not save sync statistics.");
    return {scanned,imported,updated,folder};
  }catch(error){
    const msg=error instanceof Error?error.message:"Unknown Google Drive sync error";
    await db.from("app_settings").update({last_sync_error:msg.slice(0,250)}).eq("id",1);
    throw error;
  }
}
