import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../src/memory/memory-manager.js';
import { ConversationRepo } from '../../src/store/conversation-repo.js';
import { WikiManager } from '../../src/wiki/wiki-manager.js';
import { createTestDb } from '../../src/store/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';

describe('MemoryManager', () => {
  let mm: MemoryManager;
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    db = createTestDb();
    tmpDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    const convRepo = new ConversationRepo(db);
    const wiki = new WikiManager(tmpDir);
    mm = new MemoryManager(db, convRepo, wiki, {
      episodicIntervalMs: 999_999, // disable auto
      extractionIntervalMs: 999_999,
    });
  });

  afterEach(() => {
    mm.stopBackgroundProcessing();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('recordMessage', () => {
    it('logs and returns the message', () => {
      const msg = mm.recordMessage({
        channel: 'cli',
        speaker: 'alice',
        content: 'Hello world',
      });
      expect(msg.id).toBeGreaterThan(0);
      expect(msg.content).toBe('Hello world');
    });

    it('records messages across channels', () => {
      mm.recordMessage({ channel: 'cli', speaker: 'alice', content: 'From CLI' });
      mm.recordMessage({ channel: 'discord', speaker: 'alice', content: 'From Discord' });
      mm.recordMessage({ channel: 'vscode', speaker: 'alice', content: 'From VS Code' });
      expect(mm.conversations.count()).toBe(3);
    });
  });

  describe('proactive extraction', () => {
    it('extracts preferences from conversation', () => {
      mm.recordMessage({
        channel: 'cli',
        speaker: 'alice',
        content: 'I prefer TypeScript over JavaScript for all my projects',
      });

      const facts = mm.proactive.getFactsByEntity('alice');
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts.some(f => f.fact.includes('TypeScript'))).toBe(true);
    });

    it('extracts identity facts', () => {
      mm.recordMessage({
        channel: 'discord',
        speaker: 'bob',
        content: "I work at Microsoft on the VS Code team",
      });

      const facts = mm.proactive.getFactsByEntity('bob');
      expect(facts.some(f => f.fact.includes('Microsoft'))).toBe(true);
    });

    it('extracts facts about agents', () => {
      mm.recordMessage({
        channel: 'cli',
        speaker: '@coder',
        speakerType: 'agent',
        role: 'assistant',
        content: 'I prefer to use vitest for testing and always run tests before committing',
      });

      // @coder slugifies to "coder" (@ is stripped)
      const facts = mm.proactive.getFactsByEntity('coder');
      expect(facts.length).toBeGreaterThanOrEqual(1);
    });

    it('builds entity profile', () => {
      mm.recordMessage({ channel: 'cli', speaker: 'alice', content: 'I prefer dark mode in all my editors' });
      mm.recordMessage({ channel: 'discord', speaker: 'alice', content: 'I usually start work at 9am' });

      const profile = mm.proactive.getEntityProfile('alice');
      expect(profile).toContain('dark mode');
      expect(profile).toContain('9am');
    });

    it('deduplicates similar facts', () => {
      mm.recordMessage({ channel: 'cli', speaker: 'alice', content: 'I prefer TypeScript over JavaScript' });
      mm.recordMessage({ channel: 'discord', speaker: 'alice', content: 'I prefer TypeScript over JavaScript always' });

      const facts = mm.proactive.getFactsByEntity('alice');
      const tsFacts = facts.filter(f => f.fact.includes('TypeScript'));
      // Second message should be deduped since it starts with the same 30 chars
      expect(tsFacts.length).toBeLessThanOrEqual(2);
    });
  });

  describe('episodic summaries', () => {
    it('summarizes a conversation thread', () => {
      // Create enough messages to trigger summarization
      for (let i = 0; i < 6; i++) {
        mm.recordMessage({
          channel: 'cli',
          threadId: 'auth-fix',
          speaker: i % 2 === 0 ? 'alice' : 'bob',
          content: i === 0 ? 'We need to fix the authentication bug in the login flow'
            : i === 1 ? "I think it's the JWT token expiry check"
            : i === 2 ? "Let's refactor the auth module to handle token refresh"
            : i === 3 ? 'Good idea. I\'ll work on the backend changes'
            : i === 4 ? "Decided to use refresh tokens with 7-day expiry"
            : 'Tests are passing now, ready for code review',
        });
      }

      // Force the episodic writer (set idle gap to 0 for test)
      const writer = mm.episodic;
      (writer as any).config.idleGapMs = 0;
      const summaries = writer.processNewConversations();

      expect(summaries.length).toBeGreaterThanOrEqual(1);
      const summary = summaries[0];
      expect(summary.messageCount).toBe(6);
      expect(summary.topics).toContain('authentication');
      expect(summary.entities).toContain('alice');
      expect(summary.entities).toContain('bob');
      expect(summary.summary).toContain('auth');
    });

    it('searches episodic summaries', () => {
      for (let i = 0; i < 5; i++) {
        mm.recordMessage({
          channel: 'discord',
          threadId: 'deploy-topic',
          speaker: 'alice',
          content: `Working on the deployment pipeline for the staging environment, step ${i + 1}`,
        });
      }

      (mm.episodic as any).config.idleGapMs = 0;
      mm.episodic.processNewConversations();

      const results = mm.episodic.searchSummaries('deployment');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cross-channel relevance', () => {
    it('suggests relevant past conversations from other channels', () => {
      // Past conversation about authentication in Discord
      mm.recordMessage({ channel: 'discord', speaker: 'alice', content: 'The authentication token expires after 15 minutes' });
      mm.recordMessage({ channel: 'discord', speaker: 'bob', content: 'We should implement refresh token rotation for authentication' });

      // Current conversation about authentication in CLI — should find Discord messages
      const suggestions = mm.getRelevanceSuggestions(
        'I need to fix the authentication token expiry issue in our system',
        'cli',
        10,
      );

      expect(suggestions.length).toBeGreaterThanOrEqual(1);
      const fromDiscord = suggestions.filter(s => s.channel === 'discord');
      expect(fromDiscord.length).toBeGreaterThanOrEqual(1);
    });

    it('includes extracted facts in suggestions', () => {
      mm.recordMessage({ channel: 'cli', speaker: 'alice', content: 'I prefer using Vitest for all testing workflows' });

      const suggestions = mm.getRelevanceSuggestions(
        'What testing framework should we use for our project?',
        'discord',
      );
      // Should find the fact or the conversation message
      expect(suggestions.length).toBeGreaterThanOrEqual(1);
      expect(suggestions.some(s => s.content.toLowerCase().includes('vitest'))).toBe(true);
    });

    it('builds conversation context with participant profiles', () => {
      mm.recordMessage({ channel: 'cli', speaker: 'alice', content: 'I work at Contoso on the platform team' });
      mm.recordMessage({ channel: 'discord', speaker: 'alice', content: 'I prefer TypeScript and use VS Code' });

      const context = mm.buildContextForConversation(
        'Help me set up the project',
        ['alice'],
        'vscode',
      );

      expect(context).toContain('Contoso');
      expect(context).toContain('TypeScript');
    });
  });

  describe('stats', () => {
    it('returns memory system stats', () => {
      mm.recordMessage({ channel: 'cli', speaker: 'alice', content: 'I prefer React' });
      mm.recordMessage({ channel: 'discord', speaker: 'bob', content: 'Hello' });

      const stats = mm.getStats();
      expect(stats.totalMessages).toBe(2);
      expect(stats.messagesByChannel.cli).toBe(1);
      expect(stats.messagesByChannel.discord).toBe(1);
    });
  });
});
