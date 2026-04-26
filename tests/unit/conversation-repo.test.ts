import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationRepo } from '../../src/store/conversation-repo.js';
import { createTestDb } from '../../src/store/db.js';

describe('ConversationRepo', () => {
  let repo: ConversationRepo;

  beforeEach(() => {
    repo = new ConversationRepo(createTestDb());
  });

  describe('log and retrieve', () => {
    it('logs a message and retrieves by id', () => {
      const msg = repo.log({ channel: 'cli', speaker: 'alice', content: 'Hello world' });
      expect(msg.id).toBeGreaterThan(0);
      expect(msg.channel).toBe('cli');
      expect(msg.speaker).toBe('alice');
      expect(msg.content).toBe('Hello world');

      const found = repo.getById(msg.id);
      expect(found).toBeDefined();
      expect(found!.content).toBe('Hello world');
    });

    it('logs with all fields', () => {
      const msg = repo.log({
        channel: 'discord',
        threadId: 'thread-42',
        speaker: 'bot',
        speakerType: 'agent',
        role: 'assistant',
        content: 'I can help with that',
        metadata: { model: 'gpt-5' },
      });
      expect(msg.speakerType).toBe('agent');
      expect(msg.role).toBe('assistant');
      expect(msg.threadId).toBe('thread-42');
      expect(msg.metadata.model).toBe('gpt-5');
    });
  });

  describe('cross-channel queries', () => {
    beforeEach(() => {
      repo.log({ channel: 'cli', speaker: 'alice', content: 'Working on auth bug' });
      repo.log({ channel: 'discord', speaker: 'alice', content: 'Auth bug is related to JWT expiry' });
      repo.log({ channel: 'cli', speaker: 'bob', content: 'I saw the JWT issue too' });
      repo.log({ channel: 'vscode', speaker: 'alice', content: 'Fixed the JWT token refresh' });
    });

    it('searches across all channels', () => {
      const results = repo.search('JWT');
      expect(results.length).toBe(3);
      const channels = [...new Set(results.map(r => r.channel))];
      expect(channels).toContain('discord');
      expect(channels).toContain('cli');
      expect(channels).toContain('vscode');
    });

    it('searches within a specific channel', () => {
      const results = repo.searchInChannel('cli', 'JWT');
      expect(results.length).toBe(1);
      expect(results[0].speaker).toBe('bob');
    });

    it('lists recent messages across channels', () => {
      const recent = repo.getRecent(10);
      expect(recent.length).toBe(4);
    });

    it('lists by channel', () => {
      const cli = repo.getByChannel('cli');
      expect(cli.length).toBe(2);
    });

    it('counts by channel', () => {
      const counts = repo.countByChannel();
      expect(counts.cli).toBe(2);
      expect(counts.discord).toBe(1);
      expect(counts.vscode).toBe(1);
    });
  });

  describe('threads', () => {
    beforeEach(() => {
      repo.log({ channel: 'discord', threadId: 'bug-fix', speaker: 'alice', content: 'Starting on the fix' });
      repo.log({ channel: 'discord', threadId: 'bug-fix', speaker: 'bob', content: 'Need help?' });
      repo.log({ channel: 'discord', threadId: 'bug-fix', speaker: 'alice', content: 'Yes please' });
      repo.log({ channel: 'discord', threadId: 'deploy', speaker: 'alice', content: 'Deploying now' });
    });

    it('gets messages by thread', () => {
      const thread = repo.getByThread('discord', 'bug-fix');
      expect(thread.length).toBe(3);
      expect(thread[0].content).toBe('Starting on the fix');
    });

    it('lists threads', () => {
      const threads = repo.getThreads();
      expect(threads.length).toBe(2);
      const bugThread = threads.find(t => t.threadId === 'bug-fix');
      expect(bugThread).toBeDefined();
      expect(bugThread!.messageCount).toBe(3);
      expect(bugThread!.speakers).toContain('alice');
      expect(bugThread!.speakers).toContain('bob');
    });
  });

  describe('speaker queries', () => {
    it('gets messages by speaker', () => {
      repo.log({ channel: 'cli', speaker: 'alice', content: 'Message 1' });
      repo.log({ channel: 'discord', speaker: 'alice', content: 'Message 2' });
      repo.log({ channel: 'cli', speaker: 'bob', content: 'Message 3' });

      const alice = repo.getBySpeaker('alice');
      expect(alice.length).toBe(2);
    });
  });

  describe('batch and count', () => {
    it('logs a batch of messages', () => {
      repo.logBatch([
        { channel: 'cli', speaker: 'a', content: 'one' },
        { channel: 'cli', speaker: 'b', content: 'two' },
        { channel: 'cli', speaker: 'c', content: 'three' },
      ]);
      expect(repo.count()).toBe(3);
    });
  });
});
