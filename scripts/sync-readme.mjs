#!/usr/bin/env node
// Regenerates README.md's published-image tag block from package.json's
// `version` — run `pnpm docs:sync` after bumping the version, before
// committing a release. `pnpm docs:check` (used in CI) fails instead of
// writing if the README has drifted out of sync, so a hand-edited or
// forgotten update gets caught before it reaches a customer.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const pkgPath = path.join(rootDir, "package.json");
const readmePath = path.join(rootDir, "README.md");

const BEGIN = "<!-- BEGIN GENERATED: image-tag -->";
const END = "<!-- END GENERATED: image-tag -->";
const IMAGE = "ghcr.io/stack256org/kanbanica";

const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(
    `package.json version "${version}" is not plain X.Y.Z — refusing to generate a tag block from it.`
  );
  process.exit(1);
}

const [major, minor] = version.split(".");

const block = [
  BEGIN,
  "Pin a version in production, because `latest` moves with every release:",
  "",
  "```bash",
  `docker pull ${IMAGE}:${version}`,
  "```",
  "",
  `Also tagged \`${major}\`, \`${major}.${minor}\`, and \`latest\` — every tag covers both Intel and ARM.`,
  END,
].join("\n");

const readme = readFileSync(readmePath, "utf8");
const pattern = new RegExp(`${BEGIN}[\\s\\S]*?${END}`);

if (!pattern.test(readme)) {
  console.error(
    `Could not find ${BEGIN} ... ${END} markers in README.md — nothing to sync.`
  );
  process.exit(1);
}

const next = readme.replace(pattern, block);
const checking = process.argv.includes("--check");

if (next === readme) {
  console.log("README's image-tag block is already in sync with package.json.");
  process.exit(0);
}

if (checking) {
  console.error(
    "README's image-tag block is out of sync with package.json's version.\nRun `pnpm docs:sync` and commit the result."
  );
  process.exit(1);
}

writeFileSync(readmePath, next);
console.log(`README's image-tag block updated to ${version}.`);
