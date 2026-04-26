import { describe, it, expect } from 'vitest';
import { parseDiscordCommand, formatTaskForDiscord } from '../../src/surfaces/discord.js';

describe('Discord Adapter', () => {
  describe('parseDiscordCommand', () => {
    it('parses create command', () => {
      const result = parseDiscordCommand('!task create "Fix the auth bug" --agent @coder --priority high');
      expect(result).toBeDefined();
      expect(result!.command).toBe('create');
      expect(result!.args.title).toBe('Fix the auth bug');
      expect(result!.args.agent).toBe('@coder');
      expect(result!.args.priority).toBe('high');
    });

    it('parses list command', () => {
      const result = parseDiscordCommand('!task list');
      expect(result).toBeDefined();
      expect(result!.command).toBe('list');
    });

    it('parses status command with ID', () => {
      const result = parseDiscordCommand('!task status abc123');
      expect(result).toBeDefined();
      expect(result!.command).toBe('status');
      expect(result!.args.id).toBe('abc123');
    });

    it('returns null for non-task messages', () => {
      expect(parseDiscordCommand('hello world')).toBeNull();
      expect(parseDiscordCommand('!help')).toBeNull();
    });
  });

  describe('formatTaskForDiscord', () => {
    it('formats a running task', () => {
      const result = formatTaskForDiscord({
        id: 'test-123',
        title: 'Fix auth bug',
        status: 'running',
        agent: '@coder',
        priority: 'high',
      });
      expect(result).toContain('🔄');
      expect(result).toContain('Fix auth bug');
      expect(result).toContain('test-123');
    });

    it('formats a completed task with result', () => {
      const result = formatTaskForDiscord({
        id: 'test-456',
        title: 'Deploy to staging',
        status: 'completed',
        agent: '@coder',
        priority: 'normal',
        result: { summary: 'Deployed successfully' },
      });
      expect(result).toContain('✅');
      expect(result).toContain('Deployed successfully');
    });
  });
});
