/**
 * Static UI/UX, Strict TypeScript & Senior-Accessibility Audit Script.
 * Scans src/ for responsiveness defects, overlap hazards, gradients, borders,
 * small fonts, and disallowed .js/.jsx files.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");

if (!fs.existsSync(SRC_DIR)) {
  console.log("No src/ directory found yet. Skipping UI audit.");
  process.exit(0);
}

const TARGET_EXTS = new Set([".tsx", ".ts", ".css"]);
const DISALLOWED_JS_EXTS = new Set([".js", ".jsx", ".mjs", ".cjs"]);

interface AuditCheck {
  name: string;
  regex: RegExp;
  severity: "ERROR" | "WARN";
}

function collectFiles(dir: string): { scanFiles: string[]; jsViolations: string[] } {
  const scanFiles: string[] = [];
  const jsViolations: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const nested = collectFiles(full);
      scanFiles.push(...nested.scanFiles);
      jsViolations.push(...nested.jsViolations);
    } else {
      const ext = path.extname(entry.name);
      if (DISALLOWED_JS_EXTS.has(ext)) {
        jsViolations.push(full);
      } else if (TARGET_EXTS.has(ext)) {
        scanFiles.push(full);
      }
    }
  }

  return { scanFiles, jsViolations };
}

const CHECKS: AuditCheck[] = [
  {
    name: "Gradient usage (forbidden)",
    regex: /\bbg-gradient-[a-z0-9-]+\b|\blinear-gradient\b|\bradial-gradient\b/g,
    severity: "ERROR",
  },
  {
    name: "Decorative border class (forbidden on layouts/cards/tables)",
    regex: /\bborder(?:-(?:0|2|4|8|x|y|t|r|b|l|[a-z]+-\d{2,3}))?\b(?![-:])/g,
    severity: "WARN",
  },
  {
    name: "Small font size (text-xs / text-sm below senior readability)",
    regex: /\btext-(?:xs|sm)\b/g,
    severity: "ERROR",
  },
  {
    name: "Unresponsive multi-column grid (grid-cols-2/3/4 without breakpoint prefix)",
    regex: /(?<![a-z]:)\bgrid-cols-(?:2|3|4|5|6)\b/g,
    severity: "WARN",
  },
  {
    name: "Fixed bottom-6 without responsive override (risks MobileNav overlap)",
    regex: /\bfixed\b[^"'\n]*\bbottom-6\b(?![^"'\n]*\bsm:bottom-)/g,
    severity: "WARN",
  },
  {
    name: "Arbitrary fixed pixel width (risks 375px horizontal overflow)",
    regex: /(?<![a-z]:)\bw-\[\d{3,}px\]/g,
    severity: "WARN",
  },
];

const { scanFiles, jsViolations } = collectFiles(SRC_DIR);
let errorCount = 0;
let warnCount = 0;

for (const jsFile of jsViolations) {
  errorCount++;
  console.log(
    `[ERROR] ${path.relative(ROOT, jsFile)} — Non-TypeScript source file in src/ (strictly use .ts or .tsx)`
  );
}

for (const file of scanFiles) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, "utf8").split("\n");

  lines.forEach((line, idx) => {
    for (const check of CHECKS) {
      check.regex.lastIndex = 0;
      const matches = line.match(check.regex);
      if (matches) {
        if (check.severity === "ERROR") errorCount++;
        else warnCount++;
        console.log(`[${check.severity}] ${rel}:${idx + 1} — ${check.name} (${matches.join(", ")})`);
      }
    }
  });
}

console.log(
  `\nAudit complete: ${scanFiles.length} files scanned, ${errorCount} error(s), ${warnCount} warning(s).`
);
process.exit(errorCount > 0 ? 1 : 0);
