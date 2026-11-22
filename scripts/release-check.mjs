#!/usr/bin/env node
// Release check. Read-only: it publishes nothing and needs no OTP.
//   node scripts/release-check.mjs
// Checks versions, npm state, the packed tarballs (workspace: dependencies must be resolved), the plugin manifests,
// the release tag and the git state. Prints which packages still need publishing, core first, as commands without
// an OTP: npm asks for it in the terminal.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES = ["packages/core", "mcp-servers/google", "mcp-servers/bing", "mcp-servers/yandex", "mcp-servers/performance"];
const json = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const run = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);

// 1. Plugin manifests and tag
const plugin = json(".claude-plugin/plugin.json");
const marketplace = json(".claude-plugin/marketplace.json");
if (marketplace.plugins[0].version !== plugin.version) fail(`plugin.json ${plugin.version} and marketplace.json ${marketplace.plugins[0].version} differ`);
const tag = `v${plugin.version}`;
if (!run("git", ["tag", "--list", tag])) notes.push(`tag ${tag} does not exist yet: git tag -a ${tag} -m "awesome-seo plugin ${plugin.version}" && git push origin ${tag}`);

// 2. Git state
if (run("git", ["status", "--porcelain"])) fail("working tree has uncommitted changes");
try {
  run("git", ["fetch", "-q", "origin"]);
  const [ahead, behind] = run("git", ["rev-list", "--left-right", "--count", "HEAD...origin/main"]).split(/\s+/).map(Number);
  if (ahead > 0) fail(`${ahead} commit(s) not pushed`);
  if (behind > 0) fail(`${behind} commit(s) behind origin/main`);
} catch {
  notes.push("could not compare with origin (offline?)");
}

// 3. Packages: version, npm state, packed dependencies
const coreVersion = json("packages/core/package.json").version;
const tmp = mkdtempSync(join(tmpdir(), "release-check-"));
const toPublish = [];
try {
  for (const dir of PACKAGES) {
    const pkg = json(`${dir}/package.json`);
    let latest = "";
    try {
      latest = run("npm", ["view", pkg.name, "dist-tags.latest"]);
    } catch {
      notes.push(`${pkg.name}: could not read npm state`);
    }
    const published = latest === pkg.version;
    if (!published) toPublish.push({ dir, name: pkg.name, version: pkg.version, latest });

    // pnpm pack resolves workspace: ranges the way pnpm publish does
    run("corepack", ["pnpm", "pack", "--pack-destination", tmp], join(ROOT, dir));
    const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`;
    const packed = JSON.parse(run("tar", ["-xzOf", join(tmp, tarball), "package/package.json"]));
    const deps = { ...packed.dependencies, ...packed.peerDependencies };
    for (const [name, range] of Object.entries(deps)) {
      if (String(range).startsWith("workspace:")) fail(`${pkg.name}: packed dependency ${name} is still ${range}`);
    }
    const core = packed.dependencies?.["@karailker/awesome-seo-core"];
    if (dir !== "packages/core" && core !== coreVersion) fail(`${pkg.name}: depends on core ${core}, core is ${coreVersion}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// Report
console.log(`plugin ${plugin.version} (tag ${tag}); core ${coreVersion}`);
for (const p of PACKAGES.map((d) => json(`${d}/package.json`))) {
  const entry = toPublish.find((t) => t.name === p.name);
  console.log(`  ${p.name} ${p.version}: ${entry ? `NOT on npm (latest is ${entry.latest || "unknown"})` : "published"}`);
}
for (const n of notes) console.log(`note: ${n}`);
if (problems.length) {
  console.log("\nPROBLEMS:");
  for (const p of problems) console.log(`  - ${p}`);
}
if (toPublish.length) {
  console.log("\nPublish in this order. npm asks for the OTP in the terminal; do not paste it into chat:");
  for (const t of toPublish) console.log(`  cd ${join(ROOT, t.dir)} && corepack pnpm publish --access public --no-git-checks`);
  console.log("If the publish returns 404, run `npm whoami`; if that fails, `npm login` first.");
}
process.exit(problems.length ? 1 : 0);
