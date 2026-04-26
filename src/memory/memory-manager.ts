/**
 * Memory Manager
 *
 * Orchestrates all memory subsystems (conversation log, episodic writer,
 * proactive extractor) and provides a unified interface for context retrieval
 * and cross-channel relevance suggestions.
 */

import type Database from 'better-sqlite3';
import type { ConversationRepo, ConversationMessage, LogMessageInput } from '../store/conversation-repo.js';
import type { WikiManager } from '../wiki/wiki-manager.js';
import { EpisodicWriter, type EpisodicSummary, type EpisodicConfig } from './episodic-writer.js';
import { ProactiveExtractor, type ExtractedFact, type MemoryFact } from './proactive-extractor.js';

export interface RelevanceSuggestion {
  type: 'conversation' | 'fact' | 'episodic' | 'wiki';
  source: string;
  content: string;
  score: number;
  channel?: string;
  timestamp?: string;
}

export interface MemoryConfig {
  /** Run episodic writer every N ms */
  episodicIntervalMs: number;
  /** Run proactive extraction every N ms */
  extractionIntervalMs: number;
  /** Number of recent messages to extract from each cycle */
  extractionBatchSize: number;
  episodic?: Partial<EpisodicConfig>;
}

const DEFAULT_CONFIG: MemoryConfig = {
  episodicIntervalMs: 5 * 60_000,  // 5 minutes
  extractionIntervalMs: 2 * 60_000, // 2 minutes
  extractionBatchSize: 50,
};

export class MemoryManager {
  readonly conversations: ConversationRepo;
  readonly episodic: EpisodicWriter;
  readonly proactive: ProactiveExtractor;
  private wiki: WikiManager;
  private config: MemoryConfig;

  private episodicTimer: ReturnType<typeof setInterval> | null = null;
  private extractionTimer: ReturnType<typeof setInterval> | null = null;
  private lastExtractedId = 0;

  constructor(
    db: Database.Database,
    conversationRepo: ConversationRepo,
    wiki: WikiManager,
    config?: Partial<MemoryConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.conversations = conversationRepo;
    this.wiki = wiki;
    this.episodic = new EpisodicWriter(db, conversationRepo, wiki, this.config.episodic);
    this.proactive = new ProactiveExtractor(db, wiki);
  }

  /**
   * Log a message and run proactive extraction on it.
   * This is the primary entry point for recording conversations.
   */
  recordMessage(input: LogMessageInput): ConversationMessage {
    const msg = this.conversations.log(input);

    // Inline extraction for immediate fact capture (lightweight)
    this.proactive.extractFromMessages([msg]);

    return msg;
  }

  /** Log a batch of messages */
  recordMessages(inputs: LogMessageInput[]): void {
    this.conversations.logBatch(inputs);
  }

  /**
   * Start background memory processing (episodic summaries + batch extraction).
   * Call this from the daemon on startup.
   */
  startBackgroundProcessing(): void {
    // Episodic writer — summarize idle conversations
    this.episodicTimer = setInterval(() => {
      try {
        const summaries = this.episodic.processNewConversations();
        if (summaries.length > 0) {
          console.log(`📝 Episodic: wrote ${summaries.length} conversation summary(s)`);
        }
      } catch (err: any) {
        console.error('Episodic writer error:', err.message);
      }
    }, this.config.episodicIntervalMs);

    // Proactive extractor — batch extraction for any missed messages
    this.extractionTimer = setInterval(() => {
      try {
        const newMsgs = this.conversations.getAfter(this.lastExtractedId, this.config.extractionBatchSize);
        if (newMsgs.length > 0) {
          const facts = this.proactive.extractFromMessages(newMsgs);
          this.lastExtractedId = newMsgs[newMsgs.length - 1].id;
          if (facts.length > 0) {
            console.log(`🧠 Proactive: extracted ${facts.length} fact(s)`);
          }
        }
      } catch (err: any) {
        console.error('Proactive extractor error:', err.message);
      }
    }, this.config.extractionIntervalMs);
  }

  /** Stop background processing */
  stopBackgroundProcessing(): void {
    if (this.episodicTimer) { clearInterval(this.episodicTimer); this.episodicTimer = null; }
    if (this.extractionTimer) { clearInterval(this.extractionTimer); this.extractionTimer = null; }
  }

  /**
   * Get relevance suggestions for a current message.
   * Searches across past conversations, extracted facts, episodic summaries,
   * and wiki pages to find related context.
   */
  getRelevanceSuggestions(message: string, currentChannel: string, limit = 10): RelevanceSuggestion[] {
    const suggestions: RelevanceSuggestion[] = [];
    const terms = message.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (terms.length === 0) return [];

    // Search per term to maximize cross-channel recall
    const seenMsgIds = new Set<number>();
    for (const term of terms.slice(0, 5)) {
      const pastMessages = this.conversations.search(term, 10);
      for (const msg of pastMessages) {
        if (seenMsgIds.has(msg.id)) continue;
        seenMsgIds.add(msg.id);
        if (msg.channel === currentChannel && Date.now() - new Date(msg.timestamp).getTime() < 60_000) continue;
        const crossChannel = msg.channel !== currentChannel;
        suggestions.push({
          type: 'conversation',
          source: `${msg.channel}${crossChannel ? ' (other channel)' : ''}`,
          content: `[${msg.speaker}]: ${msg.content.slice(0, 200)}`,
          score: this.scoreRelevance(message, msg.content) + (crossChannel ? 0.3 : 0),
          channel: msg.channel,
          timestamp: msg.timestamp,
        });
      }
    }

    const queryStr = terms.slice(0, 5).join(' ');

    // 2. Search extracted facts
    const facts = this.proactive.searchFacts(queryStr, 10);
    for (const fact of facts) {
      suggestions.push({
        type: 'fact',
        source: `Memory: ${fact.entitySlug}`,
        content: fact.fact,
        score: fact.confidence * this.scoreRelevance(message, fact.fact),
      });
    }

    // 3. Search episodic summaries
    const episodes = this.episodic.searchSummaries(queryStr, 5);
    for (const ep of episodes) {
      const crossChannel = ep.channel !== currentChannel;
      suggestions.push({
        type: 'episodic',
        source: `Summary: ${ep.date}${crossChannel ? ` (${ep.channel})` : ''}`,
        content: ep.summary.slice(0, 300),
        score: this.scoreRelevance(message, ep.summary) + (crossChannel ? 0.2 : 0),
        channel: ep.channel ?? undefined,
        timestamp: ep.createdAt,
      });
    }

    // 4. Search wiki pages
    const wikiResults = this.wiki.search(queryStr, 5);
    for (const wr of wikiResults) {
      suggestions.push({
        type: 'wiki',
        source: `Wiki: [[${wr.slug}]]`,
        content: `${wr.title} — ${wr.snippet}`,
        score: wr.score * 0.5,
      });
    }

    // Sort by score and deduplicate
    suggestions.sort((a, b) => b.score - a.score);
    return suggestions.slice(0, limit);
  }

  /**
   * Build a context string that can be injected into a conversation prompt.
   * Includes relevant past conversations, facts about participants, and wiki knowledge.
   */
  buildContextForConversation(
    message: string,
    speakers: string[],
    channel: string,
  ): string {
    const parts: string[] = [];

    // Participant profiles
    const profileCtx = this.proactive.getConversationContext(speakers);
    if (profileCtx) {
      parts.push('## Known Context About Participants\n' + profileCtx);
    }

    // Relevant suggestions
    const suggestions = this.getRelevanceSuggestions(message, channel, 5);
    if (suggestions.length > 0) {
      parts.push('\n## Potentially Relevant Past Context');
      for (const s of suggestions) {
        parts.push(`- [${s.type}] ${s.source}: ${s.content.slice(0, 150)}`);
      }
    }

    // Wiki index
    const wikiIndex = this.wiki.buildIndex(message);
    if (wikiIndex) {
      parts.push('\n## Knowledge Base Index\n' + wikiIndex);
    }

    return parts.join('\n');
  }

  /** Get stats about the memory system */
  getStats(): {
    totalMessages: number;
    messagesByChannel: Record<string, number>;
    totalFacts: number;
    totalEntities: number;
    totalSummaries: number;
    wikiPages: number;
  } {
    const entities = this.proactive.getAllEntities();
    return {
      totalMessages: this.conversations.count(),
      messagesByChannel: this.conversations.countByChannel(),
      totalFacts: entities.reduce((sum, e) => sum + e.factCount, 0),
      totalEntities: entities.length,
      totalSummaries: this.episodic.getRecentSummaries(999).length,
      wikiPages: this.wiki.listAll().length,
    };
  }

  private scoreRelevance(query: string, text: string): number {
    const qTerms = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const tLower = text.toLowerCase();
    let hits = 0;
    for (const term of qTerms) {
      if (tLower.includes(term)) hits++;
    }
    return qTerms.length > 0 ? hits / qTerms.length : 0;
  }
}
