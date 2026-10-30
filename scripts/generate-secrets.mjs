import { randomBytes } from "node:crypto";
console.log(`PUBLIC_CLIENT_TOKEN=${randomBytes(32).toString("hex")}`);
console.log(`CRON_SECRET=${randomBytes(32).toString("hex")}`);
console.log(`GOOGLE_TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`);
