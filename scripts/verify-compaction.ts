/**
 * End-to-end verification that Anthropic server-side compaction survives the
 * convex-agent storage round-trip.
 *
 * What it proves (or disproves):
 *   1. A real generateText call with `contextManagement.compact_20260112` returns
 *      a compaction summary block (text part w/ providerMetadata.anthropic.type==='compaction').
 *   2. That block survives convex-agent's serializeMessage -> toModelMessage
 *      (the exact functions used to persist/replay messages in Convex storage).
 *   3. When the round-tripped block is resent, Anthropic RE-APPLIES the summary
 *      (replaces compacted history) instead of re-processing the full history.
 *
 * Run: ANTHROPIC_API_KEY=... npm run verify:compaction
 *
 * Throwaway diagnostic — not part of the library build.
 */
import { generateText, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { serializeMessage, toModelMessage } from "../src/mapping.js";

const MODEL = "claude-sonnet-4-6";
const TRIGGER_TOKENS = 50_000; // documented minimum for compact_20260112

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. `direnv allow` / export it first.");
  process.exit(1);
}

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const compactionOptions = {
  anthropic: {
    contextManagement: {
      edits: [
        {
          type: "compact_20260112",
          trigger: { type: "input_tokens", value: TRIGGER_TOKENS },
        },
      ],
    },
  },
};

/** ~`approxTokens` of low-entropy-but-not-trivial filler so the trigger fires. */
function filler(approxTokens: number, tag: string): string {
  const sentence = (i: number) =>
    `In section ${tag}, observation ${i}: the quick brown fox audits ledger entry ${i * 7} ` +
    `and reconciles balance ${i * 13} against invoice ${i * 17} before archiving record ${i * 19}.`;
  const lines: string[] = [];
  // ~25 tokens/sentence -> need approxTokens/25 sentences
  const n = Math.ceil(approxTokens / 25);
  for (let i = 1; i <= n; i++) lines.push(sentence(i));
  return lines.join("\n");
}

function isCompactionMarker(part: Record<string, unknown>): boolean {
  // @ai-sdk/anthropic surfaces the compaction marker under providerOptions on
  // the response part; convex-agent also stores it under providerMetadata.
  const po = part.providerOptions as { anthropic?: { type?: string } } | undefined;
  const pm = part.providerMetadata as { anthropic?: { type?: string } } | undefined;
  return po?.anthropic?.type === "compaction" || pm?.anthropic?.type === "compaction";
}

function findCompactionPart(msg: ModelMessage): unknown | undefined {
  if (typeof msg.content === "string") return undefined;
  return (msg.content as Array<Record<string, unknown>>).find(isCompactionMarker);
}

/** Anthropic per-call iterations (compaction vs message), via AI-SDK providerMetadata. */
function iterations(meta: unknown): Array<{ type: string; inputTokens?: number }> {
  const m = meta as { anthropic?: { iterations?: Array<{ type: string; inputTokens?: number }> } } | undefined;
  return m?.anthropic?.iterations ?? [];
}

async function roundTrip(msg: ModelMessage): Promise<ModelMessage> {
  // ctx/component are only touched by storeFile (large binary) — unused for text.
  const { message } = await serializeMessage(null as never, null as never, msg);
  return toModelMessage(message);
}

async function main() {
  console.log(`\n=== Compaction round-trip verification (model=${MODEL}, trigger=${TRIGGER_TOKENS} tok) ===\n`);

  // History large enough to cross the compaction trigger across a few turns.
  const history: ModelMessage[] = [
    { role: "user", content: `Document part A.\n${filler(22_000, "A")}\nReply only "ack A".` },
    { role: "assistant", content: "ack A" },
    { role: "user", content: `Document part B.\n${filler(22_000, "B")}\nReply only "ack B".` },
    { role: "assistant", content: "ack B" },
    { role: "user", content: `Document part C.\n${filler(22_000, "C")}\nIn one short sentence, what kinds of records do these sections describe?` },
  ];

  // ---- Turn 1: should trigger compaction ----
  console.log("[turn 1] sending large history with compaction enabled...");
  const r1 = await generateText({
    model: anthropic(MODEL),
    messages: history,
    providerOptions: compactionOptions,
  });

  console.log("[turn 1] iterations:", JSON.stringify(iterations(r1.providerMetadata)));

  const responseMsgs = r1.response.messages as ModelMessage[];
  const compactionPart = responseMsgs.map(findCompactionPart).find(Boolean);

  if (!compactionPart) {
    console.error(
      "\n[FAIL] No compaction block in the response. Compaction did not trigger.\n" +
        "       (Increase filler size, lower the trigger, or check the beta header.)",
    );
    console.error("[turn 1] response provider metadata:", JSON.stringify(r1.providerMetadata, null, 2));
    process.exit(2);
  }
  console.log("\n[turn 1] ✓ compaction block present in response.");
  console.log("[turn 1] compaction part (pre round-trip):");
  console.log(JSON.stringify(compactionPart, null, 2).slice(0, 1200));

  // ---- Round-trip the assistant response through convex-agent storage ----
  console.log("\n[round-trip] serializeMessage -> toModelMessage on each response message...");
  const restored: ModelMessage[] = [];
  for (const m of responseMsgs) restored.push(await roundTrip(m));

  const restoredCompaction = restored.map(findCompactionPart).find(Boolean);
  if (!restoredCompaction) {
    console.error("\n[FAIL] Compaction block LOST during convex-agent serialize/deserialize round-trip.");
    process.exit(3);
  }
  console.log("[round-trip] ✓ compaction metadata survived storage round-trip.");
  console.log("[round-trip] compaction part (post round-trip):");
  console.log(JSON.stringify(restoredCompaction, null, 2).slice(0, 1200));

  const before = JSON.stringify(compactionPart);
  const after = JSON.stringify(restoredCompaction);
  console.log(`[round-trip] byte-identical before/after: ${before === after ? "YES" : "NO (inspect above)"}`);

  // ---- Turn 2: resend full history + round-tripped compaction block ----
  // If the block is honored, Anthropic replaces the compacted span with the
  // summary -> turn-2 input_tokens should be far below turn-1's raw history.
  console.log("\n[turn 2] resending history + round-tripped compaction block + new question...");
  const turn2: ModelMessage[] = [
    ...history,
    ...restored,
    { role: "user", content: "Thanks. Reply with just the single word: OK." },
  ];
  const r2 = await generateText({
    model: anthropic(MODEL),
    messages: turn2,
    providerOptions: compactionOptions,
  });
  const t2iters = iterations(r2.providerMetadata);
  console.log("[turn 2] iterations:", JSON.stringify(t2iters));

  // If the round-tripped compaction block is honored, the API replaces the
  // already-compacted span with the stored summary instead of re-compacting it.
  // Tell: turn-2 has NO fresh compaction iteration over the big (~115k) history.
  const t1msgIn = iterations(r1.providerMetadata).find((i) => i.type === "message")?.inputTokens ?? Number.NaN;
  const bigRecompaction = t2iters.find(
    (i) => i.type === "compaction" && (i.inputTokens ?? 0) > 50_000,
  );
  const t2msgIn = t2iters.find((i) => i.type === "message")?.inputTokens ?? (r2.usage.inputTokens ?? Number.NaN);
  console.log(`\n[verdict] turn-1 message input=${t1msgIn}, turn-2 message input=${t2msgIn}`);
  console.log(`[verdict] turn-2 re-compacted the full history? ${bigRecompaction ? "YES (block NOT honored)" : "no"}`);
  const reApplied = !bigRecompaction && Number.isFinite(t2msgIn) && t2msgIn < 50_000;

  console.log("\n=== RESULT ===");
  console.log("compaction triggered:                 ✓");
  console.log(`block survived storage round-trip:    ${restoredCompaction ? "✓" : "✗"}`);
  console.log(
    `summary re-applied on resend:         ${reApplied ? "✓ (no re-compaction; small message input)" : "✗ (history was re-compacted — block not honored)"}`,
  );
  if (restoredCompaction && reApplied) {
    console.log("\n✅ PASS: proper Anthropic compaction works end-to-end through convex-agent storage.");
    process.exit(0);
  }
  console.log("\n⚠️  Partial: storage round-trip preserves the block, but re-application on resend was not observed — inspect iterations above.");
  process.exit(restoredCompaction ? 0 : 4);
}

main().catch((err) => {
  console.error("\n[ERROR]", err);
  process.exit(1);
});
