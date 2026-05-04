import { describe, it, expect } from 'vitest';
import { parseAgentContent, AgentLoader } from '../../src/execution/agent-loader.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('Agent Loader', () => {
  describe('parseAgentContent', () => {
    it('parses a valid agent.md file', () => {
      const content = `---
name: Coder
description: Software engineering specialist
model: gpt-5.4
skills:
  - testing
tools:
  - file_read
  - file_write
---
You are Coder, a software engineering specialist.
Focus on code quality.`;

      const agent = parseAgentContent(content);
      expect(agent.name).toBe('Coder');
      expect(agent.description).toBe('Software engineering specialist');
      expect(agent.model).toBe('gpt-5.4');
      expect(agent.skills).toEqual(['testing']);
      expect(agent.tools).toEqual(['file_read', 'file_write']);
      expect(agent.systemPrompt).toContain('You are Coder');
    });

    it('applies defaults for missing optional fields', () => {
      const content = `---
name: Simple
description: A simple agent
---
Do simple things.`;

      const agent = parseAgentContent(content);
      expect(agent.model).toBe('auto');
      expect(agent.skills).toEqual([]);
      expect(agent.tools).toEqual([]);
      expect(agent.mcpServers).toEqual([]);
    });

    it('accepts UTF-8 BOM before frontmatter', () => {
      const content = `\uFEFF---
name: BOM Agent
description: Includes byte order mark
---
Do simple things.`;

      const agent = parseAgentContent(content);
      expect(agent.name).toBe('BOM Agent');
      expect(agent.systemPrompt).toBe('Do simple things.');
    });

    it('throws on missing frontmatter', () => {
      expect(() => parseAgentContent('no frontmatter here')).toThrow('no YAML frontmatter');
    });
  });

  describe('AgentLoader', () => {
    it('loads agents from the bundled directory', () => {
      const bundledDir = join(process.cwd(), 'agents');
      const loader = new AgentLoader([bundledDir]);
      const agents = loader.list();
      expect(agents.length).toBeGreaterThanOrEqual(4);
      expect(loader.has('@coder')).toBe(true);
      expect(loader.has('@orchestrator')).toBe(true);
      expect(loader.has('@designer')).toBe(true);
      expect(loader.has('@general-purpose')).toBe(true);
    });

    it('gets an agent by name', () => {
      const bundledDir = join(process.cwd(), 'agents');
      const loader = new AgentLoader([bundledDir]);
      const coder = loader.get('@coder');
      expect(coder).toBeDefined();
      expect(coder!.model).toBe('gpt-5.4');
    });

    it('handles non-existent directory gracefully', () => {
      const loader = new AgentLoader(['/nonexistent/path']);
      expect(loader.list()).toEqual([]);
    });

    it('keeps existing agents if a reload fails', () => {
      const dir = mkdtempSync(join(tmpdir(), 'ghc-agent-loader-'));
      try {
        const agentPath = join(dir, 'good.agent.md');
        writeFileSync(agentPath, `---
name: Good
description: Valid agent
---
Prompt.`);

        const loader = new AgentLoader([dir]);
        expect(loader.has('@good')).toBe(true);

        writeFileSync(agentPath, 'invalid content');
        expect(() => loader.reload()).toThrow('no YAML frontmatter');
        expect(loader.has('@good')).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
