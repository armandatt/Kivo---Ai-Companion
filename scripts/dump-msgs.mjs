import pg from 'pg';
const { Client } = pg;
const c = new Client({ connectionString: "postgresql://neondb_owner:npg_B52lgHGDZTXd@ep-late-band-a46kxn8z-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require" });
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
