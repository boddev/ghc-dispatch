import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const AgentFrontmatter = z.object({
  name: z.string(),
  description: z.string(),
  model: z.string().default('auto'),
  skills: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  mcpServers: z.array(z.string()).default([]),
  domain: z.string().optional(),
  teamType: z.string().optional(),
  teamRoles: z.array(z.string()).default([]),
  preferredTasks: z.array(z.string()).default([]),
  antiTasks: z.array(z.string()).default([]),
  handoffStyle: z.string().optional(),
  leadershipStyle: z.string().optional(),
  allowedPeers: z.array(z.string()).default([]),
});

export type AgentDefinition = z.infer<typeof AgentFrontmatter> & {
  systemPrompt: string;
  filePath: string;
};

export interface CreateAgentInput {
  name: string;
  description: string;
  model?: string;
  skills?: string[];
  tools?: string[];
  mcpServers?: string[];
  systemPrompt: string;
}

export function agentSlug(name: string): string {
  return name
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function agentHandle(name: string): string {
  const slug = agentSlug(name);
  if (!slug) throw new Error('Agent name must contain at least one letter or number');
  return `@${slug}`;
}

export function parseAgentFile(filePath: string): AgentDefinition {
  const raw = readFileSync(filePath, 'utf-8');
  return parseAgentContent(raw, filePath);
}

export function parseAgentContent(content: string, filePath = '<inline>'): AgentDefinition {
  const normalizedContent = content.replace(/^\uFEFF/, '');
  const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = normalizedContent.match(fmRegex);
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
    const nextAgents = new Map<string, AgentDefinition>();
    for (const dir of this.dirs) {
      const defs = loadAgentsFromDir(dir);
      for (const def of defs) {
        nextAgents.set(agentHandle(def.name), def);
      }
    }
    this.agents = nextAgents;
  }

  get(agentName: string): AgentDefinition | undefined {
    return this.agents.get(agentHandle(agentName));
  }

  list(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  has(agentName: string): boolean {
    return this.get(agentName) !== undefined;
  }

  create(input: CreateAgentInput): AgentDefinition {
    const content = [
      '---',
      `name: ${input.name}`,
      `description: ${input.description}`,
      `model: ${input.model ?? 'auto'}`,
      `skills: ${JSON.stringify(input.skills ?? [])}`,
      `tools: ${JSON.stringify(input.tools ?? [])}`,
      `mcpServers: ${JSON.stringify(input.mcpServers ?? [])}`,
      '---',
      input.systemPrompt.trim(),
      '',
    ].join('\n');

    return this.createFromContent(content);
  }

  createFromContent(content: string): AgentDefinition {
    const userDir = this.dirs.at(-1) ?? this.dirs[0];
    if (!userDir) throw new Error('No agent directory configured');

    mkdirSync(userDir, { recursive: true });
    const parsed = parseAgentContent(content);
    const slug = agentSlug(parsed.name);
    const handle = agentHandle(parsed.name);

    const filePath = join(userDir, `${slug}.agent.md`);
    if (existsSync(filePath)) {
      this.reload();
      const existing = this.get(handle);
      if (existing) return existing;
      throw new Error(`Agent already exists but could not be loaded: ${handle}`);
    }

    writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf-8');
    this.reload();
    const created = this.get(handle);
    if (!created) throw new Error(`Agent was written but could not be loaded: ${handle}`);
    return created;
  }

  getDefault(): AgentDefinition {
    return this.get('@general-purpose') ?? this.get('@orchestrator') ?? this.list()[0];
  }
}
