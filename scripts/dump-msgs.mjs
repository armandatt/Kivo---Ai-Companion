import pg from 'pg';
const { Client } = pg;
// Reads the database URL from the environment; never hardcode it here.
//   node --env-file=packages/db/.env scripts/dump-msgs.mjs
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL is not set. Run: node --env-file=packages/db/.env scripts/dump-msgs.mjs");
  process.exit(1);
}
const c = new Client({ connectionString: DB_URL });
await c.connect();

const { rows } = await c.query(`
  SELECT m.role, m.text, m.emotion, m.intent, m."createdAt", u."displayName", u.id as uid
  FROM "CompanionMessage" m
  JOIN "MessengerUser" u ON u.id = m."userId"
  ORDER BY m."createdAt" ASC
`);

console.log('TOTAL:', rows.length, 'messages\n');
for (const r of rows) {
  const who = r.role === 'user' ? 'USER' : 'REX ';
  const ts = r.createdAt.toISOString().slice(0,16);
  const em = r.emotion ? `[${r.emotion}]` : '';
  console.log(`${ts} ${who} ${r.displayName||'?'} ${em}`);
  console.log(`  ${r.text.replace(/\n/g,' ').slice(0,220)}`);
  console.log('');
}

await c.end();
