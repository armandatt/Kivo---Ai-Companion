// Reads Nova's Telegram log lines and reports where the time goes.
//
//   <logs> | npx tsx scripts/novaTelegramLatency.ts
//   npx tsx scripts/novaTelegramLatency.ts render.log
//
// Input: any text that contains the one JSON line Nova writes per update
// ({"layer":"nova_telegram", ...}), for example a download of the API
// service's logs. Other lines are ignored. Output: for each kind of update,
// how many there were and the P50 / P95 of each stage, in milliseconds, plus
// how often each stage was the slow one and how many model calls were made.
// Nothing a learner wrote is in those lines, and nothing is written anywhere.

import { readFileSync } from "node:fs";

interface Line {
  layer?: string; type?: string; decision?: string | null; failure?: string; modelCalls?: number; slowStage?: string | null;
  timings?: Record<string, number>;
}

const input = readFileSync(process.argv[2] ?? 0, "utf8");
const turns: Line[] = [];
for (const raw of input.split("\n")) {
  const at = raw.indexOf('{"ts"');
  if (at < 0 || !raw.includes('"nova_telegram"')) continue;
  try {
    const line = JSON.parse(raw.slice(at)) as Line;
    if (line.layer === "nova_telegram" && line.timings) turns.push(line);
  } catch { /* not one of ours */ }
}
if (turns.length === 0) {
  console.log("No Nova Telegram turns with timings found. They are logged by the API from this version on.");
  process.exit(0);
}

// What the learner would call it: a command, a button, a message Nova
// answered from code, a message the Response Brain worded, or a failure.
function kindOf(t: Line): string {
  if (t.failure && t.failure !== "none") return `failed: ${t.failure}`;
  if (t.type === "command")  return "command";
  if (t.type === "callback") return "button";
  if (t.type === "text")     return (t.modelCalls ?? 0) >= 2 ? "message, worded (2 model calls)" : "message, answered by code (1 model call)";
  return t.type ?? "other";
}

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
};

const STAGES = ["replyMs", "totalMs", "webhookMs", "learnerMs", "contextMs", "understandingMs", "decisionMs", "actionMs", "responseMs", "telegramSendMs", "persistMs"];
const groups = new Map<string, Line[]>();
for (const t of turns) groups.set(kindOf(t), [...(groups.get(kindOf(t)) ?? []), t]);

console.log(`${turns.length} updates\n`);
for (const [kind, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${kind}  (${list.length})`);
  console.log(`  ${"stage".padEnd(16)} ${"P50".padStart(7)} ${"P95".padStart(7)}`);
  for (const stage of STAGES) {
    const values = list.map(t => t.timings?.[stage] ?? 0);
    if (values.every(v => v === 0)) continue;
    const note = stage === "replyMs" ? "   what the learner waits" : "";
    console.log(`  ${stage.padEnd(16)} ${String(percentile(values, 0.5)).padStart(7)} ${String(percentile(values, 0.95)).padStart(7)}${note}`);
  }
  const slow = new Map<string, number>();
  for (const t of list) if (t.slowStage) slow.set(t.slowStage, (slow.get(t.slowStage) ?? 0) + 1);
  if (slow.size > 0) console.log(`  slow stage: ${[...slow.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ×${n}`).join(", ")}`);
  console.log("");
}
