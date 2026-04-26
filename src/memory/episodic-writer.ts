/**
 * Episodic Memory Writer
 *
 * Periodically summarizes conversation threads into wiki pages, creating
 * a searchable record of what was discussed, decided, and learned.
 *
 * Summaries are stored at conversations/YYYY-MM-DD.md (or per-thread)
 * with cross-references to entity pages for people, projects, and topics.
 */

import type { ConversationRepo, ConversationMessage } from '../store/conversation-repo.js';
import type { WikiManager } from '../wiki/wiki-manager.js';
import type Database from 'better-sqlite3';

export interface EpisodicSummary {
  id: number;
  date: string;
  channel: string | null;
  threadId: string | null;
  summary: string;
  topics: string[];
  entities: string[];
  decisions: string[];
  messageCount: number;
  firstMessageId: number | null;
  lastMessageId: number | null;
  createdAt: string;
}

export interface EpisodicConfig {
  /** Minimum messages before a thread is worth summarizing */
  minMessagesForSummary: number;
  /** Minimum idle gap (ms) before summarizing an active thread */
  idleGapMs: number;
  /** Maximum age (ms) of unsummarized conversations before forcing a summary */
  maxUnsummarizedAgeMs: number;
}

const DEFAULT_CONFIG: EpisodicConfig = {
  minMessagesForSummary: 4,
  idleGapMs: 30 * 60_000, // 30 minutes
  maxUnsummarizedAgeMs: 24 * 60 * 60_000, // 24 hours
};

export class EpisodicWriter {
  private stmts: ReturnType<typeof this.prepareStatements>;
  private config: EpisodicConfig;
  private lastProcessedId = 0;

  constructor(
    private db: Database.Database,
    private conversationRepo: ConversationRepo,
    private wiki: WikiManager,
    config?: Partial<EpisodicConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stmts = this.prepareStatements();
    this.lastProcessedId = this.getMaxProcessedId();
  }

  private prepareStatements() {
    return {
      insertSummary: this.db.prepare(`
        INSERT INTO episodic_summaries
          (date, channel, thread_id, summary, topics, entities, decisions,
           message_count, first_message_id, last_message_id, created_at)
        VALUES (@date, @channel, @threadId, @summary, @topics, @entities, @decisions,
                @messageCount, @firstMessageId, @lastMessageId, @createdAt)
      `),
      getSummariesByDate: this.db.prepare(`
        SELECT * FROM episodic_summaries WHERE date = ? ORDER BY created_at ASC
      `),
      getSummariesByChannel: this.db.prepare(`
        SELECT * FROM episodic_summaries WHERE channel = ? ORDER BY date DESC LIMIT ?
      `),
      getRecentSummaries: this.db.prepare(`
        SELECT * FROM episodic_summaries ORDER BY created_at DESC LIMIT ?
      `),
      searchSummaries: this.db.prepare(`
        SELECT * FROM episodic_summaries
        WHERE summary LIKE @query OR topics LIKE @query OR entities LIKE @query
        ORDER BY created_at DESC LIMIT @limit
      `),
      getMaxProcessedId: this.db.prepare(`
        SELECT COALESCE(MAX(last_message_id), 0) as max_id FROM episodic_summaries
      `),
    };
  }

  /**
   * Process new conversations and generate episodic summaries.
   * Call this periodically (e.g. every few minutes).
   */
  processNewConversations(): EpisodicSummary[] {
    const newMessages = this.conversationRepo.getAfter(this.lastProcessedId, 1000);
    if (newMessages.length < this.config.minMessagesForSummary) return [];

    // Group messages by date + channel + thread
    const groups = this.groupMessages(newMessages);
    const summaries: EpisodicSummary[] = [];

    for (const [key, messages] of groups) {
      if (messages.length < this.config.minMessagesForSummary) continue;

      // Check idle gap — don't summarize active conversations
      const lastMsg = messages[messages.length - 1];
      const idleMs = Date.now() - new Date(lastMsg.timestamp).getTime();
      if (idleMs < this.config.idleGapMs) continue;

      const summary = this.generateSummary(messages);
      const saved = this.saveSummary(summary);
      summaries.push(saved);

      // Also write to wiki
      this.writeToWiki(saved);

      this.lastProcessedId = Math.max(this.lastProcessedId, messages[messages.length - 1].id);
    }

    return summaries;
  }

  getSummariesByDate(date: string): EpisodicSummary[] {
    return (this.stmts.getSummariesByDate.all(date) as any[]).map(this.rowToSummary);
  }

  getSummariesByChannel(channel: string, limit = 20): EpisodicSummary[] {
    return (this.stmts.getSummariesByChannel.all(channel, limit) as any[]).map(this.rowToSummary);
  }

  getRecentSummaries(limit = 10): EpisodicSummary[] {
    return (this.stmts.getRecentSummaries.all(limit) as any[]).map(this.rowToSummary);
  }

  searchSummaries(query: string, limit = 20): EpisodicSummary[] {
    return (this.stmts.searchSummaries.all({ query: `%${query}%`, limit }) as any[]).map(this.rowToSummary);
  }

  private generateSummary(messages: ConversationMessage[]): Omit<EpisodicSummary, 'id'> {
    const speakers = [...new Set(messages.map(m => m.speaker))];
    const date = messages[0].timestamp.split('T')[0];
    const channel = messages[0].channel;
    const threadId = messages[0].threadId;

    // Extract topics from conversation content
    const topics = this.extractTopics(messages);
    const entities = this.extractEntities(messages);
    const decisions = this.extractDecisions(messages);

    // Build summary text
    const summaryParts: string[] = [];
    summaryParts.push(`Conversation on ${date} in ${channel}${threadId ? ` (thread: ${threadId})` : ''}`);
    summaryParts.push(`Participants: ${speakers.join(', ')}`);
    summaryParts.push(`${messages.length} messages`);
    summaryParts.push('');

    // Condensed message digest
    const digest = this.buildDigest(messages);
    summaryParts.push(digest);

    if (topics.length) summaryParts.push(`\nTopics: ${topics.join(', ')}`);
    if (decisions.length) summaryParts.push(`\nDecisions: ${decisions.join('; ')}`);
    if (entities.length) summaryParts.push(`\nEntities mentioned: ${entities.map(e => `[[${e}]]`).join(', ')}`);

    return {
      date,
      channel,
      threadId,
      summary: summaryParts.join('\n'),
      topics,
      entities,
      decisions,
      messageCount: messages.length,
      firstMessageId: messages[0].id,
      lastMessageId: messages[messages.length - 1].id,
      createdAt: new Date().toISOString(),
    };
  }

  private buildDigest(messages: ConversationMessage[]): string {
    const lines: string[] = [];
    let lastSpeaker = '';

    for (const msg of messages) {
      const prefix = msg.speaker !== lastSpeaker ? `**${msg.speaker}:** ` : '  ';
      const truncated = msg.content.length > 300 ? msg.content.slice(0, 300) + '...' : msg.content;
      lines.push(`${prefix}${truncated}`);
      lastSpeaker = msg.speaker;
    }

    return lines.join('\n');
  }

  private extractTopics(messages: ConversationMessage[]): string[] {
    const allText = messages.map(m => m.content).join(' ').toLowerCase();
    const topicPatterns: Array<[RegExp, string]> = [
      [/\b(?:bug|fix|debug|error|crash|issue)\b/i, 'debugging'],
      [/\b(?:deploy|deployment|release|ship|staging|production)\b/i, 'deployment'],
      [/\b(?:auth|login|password|jwt|token|session)\b/i, 'authentication'],
      [/\b(?:test|testing|coverage|spec|unit test)\b/i, 'testing'],
      [/\b(?:refactor|cleanup|technical debt)\b/i, 'refactoring'],
      [/\b(?:design|ui|ux|layout|css|component)\b/i, 'design'],
      [/\b(?:api|endpoint|rest|graphql|grpc)\b/i, 'api'],
      [/\b(?:database|sql|query|migration|schema)\b/i, 'database'],
      [/\b(?:performance|optimize|cache|latency|slow)\b/i, 'performance'],
      [/\b(?:security|vulnerability|cve|audit)\b/i, 'security'],
      [/\b(?:config|configuration|settings|env)\b/i, 'configuration'],
      [/\b(?:docker|container|kubernetes|k8s)\b/i, 'infrastructure'],
      [/\b(?:ci\/cd|pipeline|github actions|workflow)\b/i, 'ci-cd'],
      [/\b(?:review|pr|pull request|code review)\b/i, 'code-review'],
      [/\b(?:meeting|standup|sync|retro)\b/i, 'meetings'],
      [/\b(?:plan|roadmap|milestone|sprint)\b/i, 'planning'],
    ];

    const found = new Set<string>();
    for (const [pattern, topic] of topicPatterns) {
      if (pattern.test(allText)) found.add(topic);
    }
    return [...found];
  }

  private extractEntities(messages: ConversationMessage[]): string[] {
    const entities = new Set<string>();

    // Speakers are entities
    for (const msg of messages) {
      entities.add(msg.speaker.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    }

    // Look for @mentions
    const allText = messages.map(m => m.content).join(' ');
    const mentions = allText.match(/@[\w-]+/g);
    if (mentions) {
      for (const m of mentions) {
        entities.add(m.slice(1).toLowerCase());
      }
    }

    // Look for repo references (org/repo)
    const repos = allText.match(/[\w-]+\/[\w-]+/g);
    if (repos) {
      for (const r of repos) {
        if (!r.includes('//')) entities.add(r.toLowerCase());
      }
    }

    return [...entities].filter(e => e.length > 1);
  }

  private extractDecisions(messages: ConversationMessage[]): string[] {
    const decisions: string[] = [];
    const decisionPatterns = [
      /(?:decided|let's|we(?:'ll| will)|going to|plan to|agreed)\s+(.{10,80})/gi,
      /(?:decision|conclusion|outcome):\s*(.{10,120})/gi,
    ];

    for (const msg of messages) {
      for (const pattern of decisionPatterns) {
        const matches = msg.content.matchAll(pattern);
        for (const match of matches) {
          decisions.push(match[1].trim().replace(/[.!?]+$/, ''));
        }
      }
    }

    return [...new Set(decisions)].slice(0, 5);
  }

  private saveSummary(summary: Omit<EpisodicSummary, 'id'>): EpisodicSummary {
    this.stmts.insertSummary.run({
      date: summary.date,
      channel: summary.channel,
      threadId: summary.threadId,
      summary: summary.summary,
      topics: JSON.stringify(summary.topics),
      entities: JSON.stringify(summary.entities),
      decisions: JSON.stringify(summary.decisions),
      messageCount: summary.messageCount,
      firstMessageId: summary.firstMessageId,
      lastMessageId: summary.lastMessageId,
      createdAt: summary.createdAt,
    });
    const id = (this.db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
    return { ...summary, id };
  }

  private writeToWiki(summary: EpisodicSummary): void {
    const slug = `conversations/${summary.date}`;
    const existing = this.wiki.read(slug);

    const section = [
      `\n## ${summary.channel}${summary.threadId ? ` — ${summary.threadId}` : ''} (${summary.messageCount} messages)`,
      '',
      summary.summary,
      '',
    ].join('\n');

    if (existing) {
      this.wiki.update(slug, {
        body: existing.body + '\n' + section,
        tags: [...new Set([...existing.frontmatter.tags, ...summary.topics])],
      });
    } else {
      this.wiki.write(
        slug,
        `Conversations — ${summary.date}`,
        section,
        ['conversation', 'episodic', ...summary.topics],
      );
    }
  }

  private groupMessages(messages: ConversationMessage[]): Map<string, ConversationMessage[]> {
    const groups = new Map<string, ConversationMessage[]>();

    for (const msg of messages) {
      const date = msg.timestamp.split('T')[0];
      const key = `${date}|${msg.channel}|${msg.threadId ?? 'main'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(msg);
    }

    return groups;
  }

  private getMaxProcessedId(): number {
    return (this.stmts.getMaxProcessedId.get() as { max_id: number }).max_id;
  }

  private rowToSummary(row: any): EpisodicSummary {
    return {
      id: row.id,
      date: row.date,
      channel: row.channel,
      threadId: row.thread_id,
      summary: row.summary,
      topics: JSON.parse(row.topics),
      entities: JSON.parse(row.entities),
      decisions: JSON.parse(row.decisions),
      messageCount: row.message_count,
      firstMessageId: row.first_message_id,
      lastMessageId: row.last_message_id,
      createdAt: row.created_at,
    };
  }
}
