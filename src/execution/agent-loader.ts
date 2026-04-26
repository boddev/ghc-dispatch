import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const AgentFrontmatter = z.object({
  name: z.string(),
  description: z.string(),
  model: z.string().default('auto'),
  skills: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  mcpServers: z.array(z.string()).default([]),
});

export type AgentDefinition = z.infer<typeof AgentFrontmatter> & {
  systemPrompt: string;
  filePath: string;
};

export function parseAgentFile(filePath: string): AgentDefinition {
  const raw = readFileSync(filePath, 'utf-8');
  return parseAgentContent(raw, filePath);
}

export function parseAgentContent(content: string, filePath = '<inline>'): AgentDefinition {
  const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(fmRegex);
  if (!match) {
    throw new Error(`Invalid agent file (no YAML frontmatter): ${filePath}`);
  }

  const frontmatter = AgentFrontmatter.parse(parseYaml(match[1]));
  const systemPrompt = match[2].trim();

  // Normalize line endings (Windows \r\n)
  const clean = (s: string) => s.replace(/\r/g, '');

  return {
    ...frontmatter,
    name: clean(frontmatter.name),
    description: clean(frontmatter.description),
    model: clean(frontmatter.model),
    systemPrompt: clean(systemPrompt),
    filePath,
  };
}

export function loadAgentsFromDir(dirPath: string): AgentDefinition[] {
  if (!existsSync(dirPath)) return [];

  const files = readdirSync(dirPath).filter(f => f.endsWith('.agent.md'));
  return files.map(f => parseAgentFile(join(dirPath, f)));
}

export class AgentLoader {
  private agents = new Map<string, AgentDefinition>();
  private dirs: string[];

  constructor(agentDirs: string[]) {
    this.dirs = agentDirs;
    this.reload();
  }

  reload(): void {
    this.agents.clear();
    for (const dir of this.dirs) {
      const defs = loadAgentsFromDir(dir);
      for (const def of defs) {
        const key = `@${def.name.toLowerCase().replace(/\s+/g, '-')}`;
        this.agents.set(key, def);
      }
    }
  }

  get(agentName: string): AgentDefinition | undefined {
    const key = agentName.startsWith('@') ? agentName.toLowerCase() : `@${agentName.toLowerCase()}`;
    return this.agents.get(key);
  }

  list(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  has(agentName: string): boolean {
    return this.get(agentName) !== undefined;
  }

  getDefault(): AgentDefinition {
    return this.get('@general-purpose') ?? this.get('@orchestrator') ?? this.list()[0];
  }
}
