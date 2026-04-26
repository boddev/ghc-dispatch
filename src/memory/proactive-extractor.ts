/**
 * Proactive Memory Extractor
 *
 * Analyzes conversation messages to extract facts, preferences, and knowledge
 * about users and agents. Files extracted facts into wiki entity pages so the
 * system learns about its users and agents over time.
 *
 * Extracted facts are also stored in the memory_facts table for querying.
 */

import type { ConversationMessage } from '../store/conversation-repo.js';
import type { WikiManager } from '../wiki/wiki-manager.js';
import type Database from 'better-sqlite3';

export interface ExtractedFact {
  entity: string;
  entityType: 'user' | 'agent' | 'project' | 'tool' | 'preference';
  fact: string;
  confidence: number;
  sourceChannel: string;
  sourceMessageId: number;
}

export interface MemoryFact {
  id: number;
  entitySlug: string;
  entityType: string;
  fact: string;
  sourceChannel: string | null;
  sourceConversationId: number | null;
  confidence: number;
  extractedAt: string;
}

export class ProactiveExtractor {
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(
    private db: Database.Database,
    private wiki: WikiManager,
  ) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insertFact: this.db.prepare(`
        INSERT INTO memory_facts (entity_slug, entity_type, fact, source_channel, source_conversation_id, confidence, extracted_at)
        VALUES (@entitySlug, @entityType, @fact, @sourceChannel, @sourceConversationId, @confidence, @extractedAt)
      `),
      getFactsByEntity: this.db.prepare(`
        SELECT * FROM memory_facts WHERE entity_slug = ? ORDER BY extracted_at DESC
      `),
      getFactsByType: this.db.prepare(`
        SELECT * FROM memory_facts WHERE entity_type = ? ORDER BY extracted_at DESC LIMIT ?
      `),
      searchFacts: this.db.prepare(`
        SELECT * FROM memory_facts WHERE fact LIKE @query OR entity_slug LIKE @query
        ORDER BY confidence DESC, extracted_at DESC LIMIT @limit
      `),
      getRecentFacts: this.db.prepare(`
        SELECT * FROM memory_facts ORDER BY extracted_at DESC LIMIT ?
      `),
      hasFact: this.db.prepare(`
        SELECT COUNT(*) as count FROM memory_facts
        WHERE entity_slug = @entitySlug AND fact LIKE @factPattern
      `),
      getAllEntities: this.db.prepare(`
        SELECT entity_slug, entity_type, COUNT(*) as fact_count
        FROM memory_facts GROUP BY entity_slug, entity_type
        ORDER BY fact_count DESC
      `),
    };
  }

  /**
   * Analyze a batch of messages and extract facts about speakers and mentioned entities.
   */
  extractFromMessages(messages: ConversationMessage[]): ExtractedFact[] {
    const allFacts: ExtractedFact[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue;

      const facts = [
        ...this.extractPreferences(msg),
        ...this.extractIdentityFacts(msg),
        ...this.extractProjectFacts(msg),
        ...this.extractToolPreferences(msg),
        ...this.extractWorkPatterns(msg),
      ];

      allFacts.push(...facts);
    }

    return this.deduplicateAndStore(allFacts);
  }

  getFactsByEntity(entitySlug: string): MemoryFact[] {
    return (this.stmts.getFactsByEntity.all(entitySlug) as any[]).map(this.rowToFact);
  }

  getFactsByType(entityType: string, limit = 50): MemoryFact[] {
    return (this.stmts.getFactsByType.all(entityType, limit) as any[]).map(this.rowToFact);
  }

  searchFacts(query: string, limit = 30): MemoryFact[] {
    return (this.stmts.searchFacts.all({ query: `%${query}%`, limit }) as any[]).map(this.rowToFact);
  }

  getRecentFacts(limit = 20): MemoryFact[] {
    return (this.stmts.getRecentFacts.all(limit) as any[]).map(this.rowToFact);
  }

  getAllEntities(): Array<{ entitySlug: string; entityType: string; factCount: number }> {
    return (this.stmts.getAllEntities.all() as any[]).map(r => ({
      entitySlug: r.entity_slug,
      entityType: r.entity_type,
      factCount: r.fact_count,
    }));
  }

  /** Build a context string of everything known about an entity */
  getEntityProfile(entitySlug: string): string {
    const facts = this.getFactsByEntity(entitySlug);
    if (facts.length === 0) return '';

    const lines = [`Known facts about "${entitySlug}":`];
    for (const fact of facts) {
      lines.push(`- ${fact.fact}`);
    }
    return lines.join('\n');
  }

  /** Build context for a conversation — relevant facts about all participants */
  getConversationContext(speakers: string[], topics: string[] = []): string {
    const parts: string[] = [];

    for (const speaker of speakers) {
      const slug = speaker.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const profile = this.getEntityProfile(slug);
      if (profile) parts.push(profile);
    }

    // Also search for topic-related facts
    for (const topic of topics) {
      const topicFacts = this.searchFacts(topic, 5);
      if (topicFacts.length) {
        parts.push(`\nRelated facts about "${topic}":`);
        for (const f of topicFacts) {
          parts.push(`- [${f.entitySlug}] ${f.fact}`);
        }
      }
    }

    return parts.join('\n\n');
  }

  private extractPreferences(msg: ConversationMessage): ExtractedFact[] {
    const facts: ExtractedFact[] = [];
    const patterns: Array<[RegExp, string]> = [
      [/i (?:prefer|like|love|enjoy|use|always use)\s+(.{3,80})/i, 'prefers'],
      [/i (?:don'?t like|hate|avoid|never use|dislike)\s+(.{3,80})/i, 'dislikes'],
      [/my (?:favorite|preferred|go-to)\s+(?:\w+\s+){0,2}is\s+(.{3,60})/i, 'favorite is'],
      [/i(?:'m| am) (?:using|working with|learning|studying)\s+(.{3,60})/i, 'is working with'],
      [/i (?:usually|typically|normally|always)\s+(.{5,80})/i, 'usually'],
    ];

    for (const [pattern, prefix] of patterns) {
      const match = msg.content.match(pattern);
      if (match) {
        facts.push({
          entity: msg.speaker,
          entityType: msg.speakerType === 'agent' ? 'agent' : 'user',
          fact: `${prefix} ${match[1].trim().replace(/[.!?,;]+$/, '')}`,
          confidence: 0.8,
          sourceChannel: msg.channel,
          sourceMessageId: msg.id,
        });
      }
    }

    return facts;
  }

  private extractIdentityFacts(msg: ConversationMessage): ExtractedFact[] {
    const facts: ExtractedFact[] = [];
    const patterns: Array<[RegExp, string]> = [
      [/i(?:'m| am) (?:a |an |the )?(\w+(?:\s+\w+){0,3}?)(?:\s+(?:at|for|in)\s+.{2,40})?$/im, 'role is'],
      [/i work (?:at|for|on|in)\s+(.{2,60})/i, 'works at'],
      [/my (?:name|team|department|org) is\s+(.{2,40})/i, 'identity:'],
      [/i(?:'m| am) (?:based|located) (?:in|at)\s+(.{2,40})/i, 'located in'],
      [/my timezone is\s+(.{2,20})/i, 'timezone is'],
    ];

    for (const [pattern, prefix] of patterns) {
      const match = msg.content.match(pattern);
      if (match) {
        facts.push({
          entity: msg.speaker,
          entityType: 'user',
          fact: `${prefix} ${match[1].trim().replace(/[.!?,;]+$/, '')}`,
          confidence: 0.9,
          sourceChannel: msg.channel,
          sourceMessageId: msg.id,
        });
      }
    }

    return facts;
  }

  private extractProjectFacts(msg: ConversationMessage): ExtractedFact[] {
    const facts: ExtractedFact[] = [];

    // "X uses/is built with Y" patterns
    const projectPatterns: Array<[RegExp, (match: RegExpMatchArray) => ExtractedFact | null]> = [
      [
        /(\w[\w-]*(?:\/[\w-]+)?)\s+(?:uses|is built with|runs on|deploys to|is written in)\s+(.{2,40})/i,
        (m) => ({
          entity: m[1],
          entityType: 'project' as const,
          fact: `uses ${m[2].trim().replace(/[.!?,;]+$/, '')}`,
          confidence: 0.7,
          sourceChannel: msg.channel,
          sourceMessageId: msg.id,
        }),
      ],
      [
        /(?:deploy|push|ship)\s+(?:\w+\s+)?to\s+([\w-]+(?:\.[\w-]+)*)/i,
        (m) => ({
          entity: msg.speaker,
          entityType: 'user' as const,
          fact: `deploys to ${m[1]}`,
          confidence: 0.7,
          sourceChannel: msg.channel,
          sourceMessageId: msg.id,
        }),
      ],
    ];

    for (const [pattern, extractor] of projectPatterns) {
      const match = msg.content.match(pattern);
      if (match) {
        const fact = extractor(match);
        if (fact) facts.push(fact);
      }
    }

    return facts;
  }

  private extractToolPreferences(msg: ConversationMessage): ExtractedFact[] {
    const facts: ExtractedFact[] = [];

    // Detect tool/technology mentions in context of preference
    const toolPattern = /(?:switch|switched|move|moved|migrate|migrated) (?:to|from)\s+(\w[\w.-]*)/i;
    const match = msg.content.match(toolPattern);
    if (match) {
      facts.push({
        entity: msg.speaker,
        entityType: msg.speakerType === 'agent' ? 'agent' : 'user',
        fact: `mentioned switching to/from ${match[1]}`,
        confidence: 0.6,
        sourceChannel: msg.channel,
        sourceMessageId: msg.id,
      });
    }

    return facts;
  }

  private extractWorkPatterns(msg: ConversationMessage): ExtractedFact[] {
    const facts: ExtractedFact[] = [];

    const patterns: Array<[RegExp, string]> = [
      [/(?:every|each) (morning|evening|monday|friday|week|day|sprint)/i, 'work pattern:'],
      [/i (?:start|begin|end|finish) (?:work|my day) (?:at|around)\s+(.{2,20})/i, 'schedule:'],
      [/(?:standup|meeting|sync) (?:is |at )(.{2,30})/i, 'meeting schedule:'],
    ];

    for (const [pattern, prefix] of patterns) {
      const match = msg.content.match(pattern);
      if (match) {
        facts.push({
          entity: msg.speaker,
          entityType: 'user',
          fact: `${prefix} ${match[1].trim()}`,
          confidence: 0.7,
          sourceChannel: msg.channel,
          sourceMessageId: msg.id,
        });
      }
    }

    return facts;
  }

  private deduplicateAndStore(facts: ExtractedFact[]): ExtractedFact[] {
    const stored: ExtractedFact[] = [];

    for (const fact of facts) {
      const slug = fact.entity.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      // Check if we already have a similar fact
      const existing = this.stmts.hasFact.get({
        entitySlug: slug,
        factPattern: `%${fact.fact.slice(0, 30)}%`,
      }) as { count: number };

      if (existing.count > 0) continue;

      // Store in DB
      this.stmts.insertFact.run({
        entitySlug: slug,
        entityType: fact.entityType,
        fact: fact.fact,
        sourceChannel: fact.sourceChannel,
        sourceConversationId: fact.sourceMessageId,
        confidence: fact.confidence,
        extractedAt: new Date().toISOString(),
      });

      // File into wiki entity page
      const tags = [fact.entityType, 'auto-extracted'];
      this.wiki.remember(fact.entity, fact.fact, tags);

      stored.push(fact);
    }

    return stored;
  }

  private rowToFact(row: any): MemoryFact {
    return {
      id: row.id,
      entitySlug: row.entity_slug,
      entityType: row.entity_type,
      fact: row.fact,
      sourceChannel: row.source_channel,
      sourceConversationId: row.source_conversation_id,
      confidence: row.confidence,
      extractedAt: row.extracted_at,
    };
  }
}
