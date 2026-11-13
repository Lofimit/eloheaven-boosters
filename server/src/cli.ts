/**
 * Admin CLI (run inside the container from the Coolify terminal):
 *   node dist/cli.js promote <username> <role>
 *   node dist/cli.js set-password <username> <password>
 *   node dist/cli.js create-owner <username> <password>
 *   node dist/cli.js users
 */
import { q } from "./db.js";
import { hashPassword } from "./lib/crypto.js";
import { ROLES, type Role } from "./lib/league.js";
import { createUser, USERNAME_RE } from "./lib/users.js";

const [cmd, a, b] = process.argv.slice(2);

function need(v: string | undefined, what: string): string {
  if (!v) {
    console.error(`Missing ${what}`);
    process.exit(1);
  }
  return v;
}

switch (cmd) {
  case "promote": {
    const username = need(a, "username");
    const role = need(b, "role") as Role;
    if (!ROLES.includes(role)) throw new Error(`Role must be one of: ${ROLES.join(", ")}`);
    const r = q.run("UPDATE users SET role = ? WHERE username = ?", [role, username]);
    console.log(Number(r.changes) ? `${username} is now ${role}` : `No user named ${username}`);
    break;
  }
  case "set-password": {
    const username = need(a, "username");
    const pw = need(b, "password");
    if (pw.length < 8) throw new Error("Password must be at least 8 characters");
    const r = q.run("UPDATE users SET password_hash = ? WHERE username = ?", [await hashPassword(pw), username]);
    console.log(Number(r.changes) ? `Password updated for ${username}` : `No user named ${username}`);
    break;
  }
  case "create-owner": {
    const username = need(a, "username");
    const pw = need(b, "password");
    if (!USERNAME_RE.test(username)) throw new Error("Invalid username");
    if (pw.length < 8) throw new Error("Password must be at least 8 characters");
    const id = createUser({ username, passwordHash: await hashPassword(pw), role: "owner" });
    console.log(`Created owner ${username} (#${id})`);
    break;
  }
  case "users": {
    console.table(q.all("SELECT id, username, role, trust_rate, banned, discord_id IS NOT NULL AS discord FROM users ORDER BY id"));
    break;
  }
  default:
    console.log("Commands: promote <username> <role> | set-password <username> <password> | create-owner <username> <password> | users");
}
