/**
 * Pre-generation claim check for finance ads (Meta financial-products policy).
 * "block" findings stop voice and avatar generation; "warn" findings are shown
 * so a human can decide. This is a deterministic first pass, not legal review.
 */
export type ComplianceFinding = {
  severity: "block" | "warn";
  rule: string;
  match: string;
  message: string;
};

type Rule = { severity: "block" | "warn"; rule: string; pattern: RegExp; message: string };

const RULES: Rule[] = [
  { severity: "block", rule: "guarantee", pattern: /\bgarantier\w*|\bgarantie\b/i,
    message: "Guarantees are not allowed for financial products." },
  { severity: "block", rule: "risk-free", pattern: /\brisikofrei\w*|\brisikolos\w*|\bohne\s+risiko\b|\bkein\s+risiko\b/i,
    message: "Trading is never risk-free; remove the claim." },
  { severity: "block", rule: "get-rich", pattern: /\bsicher\w*\s+reich|\breich\s+werden\b|\bschnell\s+reich|\breich\s+in\s+\d+/i,
    message: "Get-rich-quick promises are not allowed." },
  { severity: "block", rule: "return-figure",
    pattern: /\d[\d.,]*\s*(?:%|prozent)\s*(?:rendite|gewinn\w*|profit|ertrag|return)|(?:rendite|gewinn\w*|profit|ertrag|return)\w*\s*(?:von\s*)?\d[\d.,]*\s*(?:%|prozent)/i,
    message: "Specific return or profit figures need substantiation and are blocked here." },
  { severity: "warn", rule: "income-claim", pattern: /\bgeld\s+verdien\w*|\bpassiv\w*\s+einkommen\b|\bfinanziell\w*\s+frei\w*/i,
    message: "Income or financial-freedom claim; confirm it is substantiated." },
  { severity: "warn", rule: "time-bound", pattern: /\bin\s+\d+\s*(?:tagen|wochen|monaten)\b/i,
    message: "Time-bound result claim; confirm it is substantiated." },
  { severity: "warn", rule: "euro-figure", pattern: /\d[\d.,]*\s*(?:€|euro|eur)\b/i,
    message: "Concrete money figure; confirm it is substantiated." },
  { severity: "warn", rule: "certainty", pattern: /\bsicher\b/i,
    message: "Implies certainty or safety; check the wording." },
];

export function checkScriptCompliance(text: string): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  for (const rule of RULES) {
    const hit = text.match(rule.pattern);
    if (hit) findings.push({ severity: rule.severity, rule: rule.rule, match: hit[0], message: rule.message });
  }
  return findings;
}

/** Throws when the script has blocking findings. Used before any paid API call. */
export function assertScriptCompliant(text: string): ComplianceFinding[] {
  const findings = checkScriptCompliance(text);
  const blocking = findings.filter((f) => f.severity === "block");
  if (blocking.length) {
    const details = blocking.map((f) => `"${f.match}" (${f.message})`).join("; ");
    throw new Error(`Script blocked by compliance check: ${details}`);
  }
  return findings;
}
