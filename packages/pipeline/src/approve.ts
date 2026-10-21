import readline from "node:readline/promises";

export type Approval =
  | { action: "approve" }
  | { action: "revise"; feedback: string }
  | { action: "abort" };

// GATE 1 — script review. Nothing costs money before this point.
export async function askApproval(): Promise<Approval> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (
        await rl.question("\n[a]pprove / [r]evise with feedback / [q]uit > ")
      )
        .trim()
        .toLowerCase();
      if (answer === "a") return { action: "approve" };
      if (answer === "q") return { action: "abort" };
      if (answer === "r") {
        const feedback = await rl.question("Feedback für die Überarbeitung: ");
        return { action: "revise", feedback };
      }
    }
  } finally {
    rl.close();
  }
}
