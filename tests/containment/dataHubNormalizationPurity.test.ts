import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NORMALIZER_VERSION } from "@/lib/data-hub/normalization/contracts";

const ROOT = path.resolve(__dirname, "../..");
const NORMALIZATION_DIR = path.join(ROOT, "lib/data-hub/normalization");
const FILES = fs.readdirSync(NORMALIZATION_DIR).filter((f) => f.endsWith(".ts"));

function read(file: string): string {
  return fs.readFileSync(path.join(NORMALIZATION_DIR, file), "utf8");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("6.2D4C-B2A normalization library — purity/security containment", () => {
  it("imports nothing from Prisma, the raw sql client, node:fs, node:net, or node:child_process anywhere in the library", () => {
    for (const file of FILES) {
      const code = stripComments(read(file));
      expect(code, `${file} must not import Prisma`).not.toMatch(/@prisma\/client|generated\/prisma/);
      expect(code, `${file} must not import lib\/db`).not.toMatch(/from ["']\.\.\/\.\.\/db["']|lib\/db/);
      expect(code, `${file} must not import node:fs`).not.toMatch(/from ["']node:fs["']|from ["']fs["']/);
      expect(code, `${file} must not import node:net`).not.toMatch(/from ["']node:net["']|from ["']net["']/);
      expect(code, `${file} must not import node:child_process`).not.toMatch(/child_process/);
      expect(code, `${file} must not import node:http/https`).not.toMatch(/from ["']node:https?["']|from ["']https?["']/);
    }
  });

  it("never calls console.* (would risk logging a raw cell value) anywhere in the library", () => {
    for (const file of FILES) {
      const code = stripComments(read(file));
      expect(code, `${file} must not call console.*`).not.toMatch(/console\./);
    }
  });

  it("never calls Date.now() or Math.random() — every computation must be deterministic given its explicit inputs", () => {
    for (const file of FILES) {
      const code = stripComments(read(file));
      expect(code, `${file} must not call Date.now()`).not.toMatch(/Date\.now\s*\(/);
      expect(code, `${file} must not call Math.random()`).not.toMatch(/Math\.random\s*\(/);
    }
  });

  it("never reads process.env (would make output depend on the ambient environment, e.g. the host's local TZ)", () => {
    for (const file of FILES) {
      const code = stripComments(read(file));
      expect(code, `${file} must not read process.env`).not.toMatch(/process\.env/);
    }
  });

  it("never constructs `new Date(someString)` — every Date use must be driven by explicit numeric UTC milliseconds or explicit Date.UTC(...) fields, never locale-dependent string parsing", () => {
    for (const file of FILES) {
      const code = stripComments(read(file));
      // Allow `new Date(<numeric/identifier expression>)`; forbid a string literal argument.
      const stringArgConstruction = /new Date\(\s*["'`]/;
      expect(code, `${file} must not call new Date() with a string literal`).not.toMatch(stringArgConstruction);
    }
  });

  it("hard-codes no single IANA zone as a default — 'Australia/Adelaide' appears only in documentation comments, never in executable code", () => {
    for (const file of FILES) {
      const rawSource = read(file);
      const code = stripComments(rawSource);
      expect(code, `${file} must not hard-code Australia/Adelaide in executable code`).not.toMatch(/Australia\/Adelaide/);
    }
  });

  it("exports a fixed, explicit NORMALIZER_VERSION not derived from package.json or the current date", () => {
    expect(NORMALIZER_VERSION).toBe("v1");
    const contractsSource = stripComments(read("contracts.ts"));
    expect(contractsSource).not.toMatch(/require\(["']\.\.\/\.\.\/\.\.\/package\.json["']\)/);
    expect(contractsSource).not.toMatch(/new Date\(\)/);
  });
});
