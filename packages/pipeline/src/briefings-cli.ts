import { generateAndSaveBriefings } from "./briefings-from-kb.js";

/*
 * pnpm briefings [--n 5] [--context "…"]
 * Generates briefings from the Winning Patterns KB and writes them to data/briefings/.
 */
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const count = Number(flag("--n") ?? flag("-n") ?? 5) || 5;
const context = flag("--context");

generateAndSaveBriefings(count, context).then((out) => {
  console.log(`\nGenerated ${out.length} briefing${out.length === 1 ? "" : "s"} from the Winning Patterns KB:\n`);
  for (const { file, briefing } of out) {
    console.log(`  ${file}`);
    console.log(`    Angle: ${briefing.angle}`);
    console.log(`    Hooks: ${briefing.hookConcepts.join(" | ")}`);
    if (briefing.usedPatternIds.length) console.log(`    Patterns: ${briefing.usedPatternIds.join(", ")}`);
  }
  console.log(`\nRun one with: pnpm golden <file>\n`);
}).catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
