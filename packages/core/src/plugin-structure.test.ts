// Structural checks for the plugin content: skills, commands, agents, manifests and the hook. They run without
// the network and fail when a document refers to a tool, CLI command or file that does not exist.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function files(dir: string, name?: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...files(rel, name));
    else if (name ? entry.name === name : entry.name.endsWith(".md")) out.push(rel);
  }
  return out.sort();
}

const SKILLS = files("skills", "SKILL.md");
const COMMANDS = files("commands");
const AGENTS = files("agents");
const ALL = [...SKILLS, ...COMMANDS, ...AGENTS];

const frontmatter = (text: string) => text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? null;

// Tool names the servers define: TypeScript servers list them in CONFIG, the crawler in TOOLS.
function definedTools(): Set<string> {
  const names = new Set<string>();
  for (const server of ["google", "yandex", "bing", "performance"]) {
    for (const m of read(`mcp-servers/${server}/src/index.ts`).matchAll(/\{ name: "([a-z0-9_]+)", access:/g)) names.add(m[1] as string);
  }
  for (const m of read("mcp-servers/crawl/src/crawl_server/server.py").matchAll(/\{"name": "([a-z0-9_]+)", "access"/g)) names.add(m[1] as string);
  return names;
}

const cliCommands = (): Set<string> => new Set([...read("packages/core/src/cli.ts").matchAll(/case "([a-z-]+)":/g)].map((m) => m[1] as string));

describe("plugin content", () => {
  it("finds the skills, commands and agents it checks", () => {
    expect(SKILLS.length).toBeGreaterThanOrEqual(16);
    expect(COMMANDS.length).toBeGreaterThanOrEqual(11);
    expect(AGENTS.length).toBe(5);
  });

  it.each(ALL)("%s has frontmatter with a description", (file) => {
    const fm = frontmatter(read(file));
    expect(fm, "frontmatter").not.toBeNull();
    expect(fm).toMatch(/^description:\s*\S/m);
  });

  it.each(SKILLS)("%s has a name that matches its folder", (file) => {
    const folder = file.split("/").slice(-2)[0];
    expect(frontmatter(read(file))).toMatch(new RegExp(`^name:\\s*${folder}\\s*$`, "m"));
  });

  it("refers only to CLI commands that exist", () => {
    const known = cliCommands();
    const bad: string[] = [];
    for (const file of ALL) {
      for (const m of read(file).matchAll(/core@0\.2 awesome-seo ([a-z][a-z-]*)/g)) {
        if (!known.has(m[1] as string)) bad.push(`${file}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("refers only to MCP tools that a server defines", () => {
    const known = definedTools();
    const bad: string[] = [];
    for (const file of [...ALL, "README.md", "docs/MCP.md", "docs/AGENTS-AND-SKILLS.md"]) {
      for (const m of read(file).matchAll(/mcp__plugin_awesome-seo_[a-z0-9]+__([a-z0-9_]+)/g)) {
        if (!known.has(m[1] as string)) bad.push(`${file}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("refers only to repository paths that exist", () => {
    const bad: string[] = [];
    for (const file of ALL) {
      for (const m of read(file).matchAll(/`((?:docs|hooks|packages|mcp-servers|knowledge|skills|commands|agents)\/[A-Za-z0-9_./-]+)`/g)) {
        const path = m[1] as string;
        if (!existsSync(join(ROOT, path))) bad.push(`${file}: ${path}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("plugin manifests and hook", () => {
  const plugin = JSON.parse(read(".claude-plugin/plugin.json"));
  const marketplace = JSON.parse(read(".claude-plugin/marketplace.json"));

  it("uses the same version in plugin.json and marketplace.json", () => {
    expect(marketplace.plugins[0].version).toBe(plugin.version);
  });

  it("declares the five servers, each reading the project .env except the crawler", () => {
    expect(Object.keys(plugin.mcpServers).sort()).toEqual(["bing", "crawl", "google", "performance", "yandex"]);
    for (const name of ["google", "yandex", "bing", "performance"]) {
      expect(plugin.mcpServers[name].env.AWESOME_SEO_ENV_FILE).toBe("${CLAUDE_PROJECT_DIR}/.env");
    }
    expect(plugin.mcpServers.crawl.env.AWESOME_SEO_DATA_DIR).toBe("${CLAUDE_PROJECT_DIR}/data");
  });

  it("gates every write tool and only write tools", () => {
    const hook = JSON.parse(read("hooks/hooks.json")).hooks.PreToolUse[0];
    const gated = new Set((hook.matcher as string).split("|").map((n) => n.replace(/^mcp__plugin_awesome-seo_[a-z]+__/, "")));
    const writes = new Set<string>();
    for (const server of ["google", "yandex", "bing", "performance"]) {
      for (const m of read(`mcp-servers/${server}/src/index.ts`).matchAll(/\{ name: "([a-z0-9_]+)", access: "write"/g)) writes.add(m[1] as string);
    }
    expect([...gated].sort()).toEqual([...writes].sort());
    expect(hook.hooks[0].command).toContain("bash ");
  });

  it("keeps the hook script executable in git", () => {
    expect(existsSync(join(ROOT, "hooks/scripts/validate-approval.sh"))).toBe(true);
  });
});
