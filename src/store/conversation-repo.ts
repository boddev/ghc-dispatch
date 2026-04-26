import type Database from 'better-sqlite3';

export interface ConversationMessage {
  id: number;
  channel: string;
  threadId: string | null;
  speaker: string;
  speakerType: 'user' | 'agent' | 'system';
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface LogMessageInput {
  channel: string;
  threadId?: string;
  speaker: string;
  speakerType?: 'user' | 'agent' | 'system';
  role?: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ConversationThread {
  threadId: string;
  channel: string;
  messageCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
  speakers: string[];
  preview: string;
}

export class ConversationRepo {
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(private db: Database.Database) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insert: this.db.prepare(`
        INSERT INTO conversations (channel, thread_id, speaker, speaker_type, role, content, metadata, timestamp)
        VALUES (@channel, @threadId, @speaker, @speakerType, @role, @content, @metadata, @timestamp)
      `),
      getById: this.db.prepare('SELECT * FROM conversations WHERE id = ?'),
      getByThread: this.db.prepare(`
        SELECT * FROM conversations WHERE channel = @channel AND thread_id = @threadId
        ORDER BY timestamp ASC LIMIT @limit
      `),
      getByChannel: this.db.prepare(`
        SELECT * FROM conversations WHERE channel = @channel
        ORDER BY timestamp DESC LIMIT @limit OFFSET @offset
      `),
      getRecent: this.db.prepare(`
        SELECT * FROM conversations ORDER BY timestamp DESC LIMIT @limit
      `),
      getRecentByChannel: this.db.prepare(`
        SELECT * FROM conversations WHERE channel = @channel
        ORDER BY timestamp DESC LIMIT @limit
      `),
      search: this.db.prepare(`
        SELECT * FROM conversations WHERE content LIKE @query
        ORDER BY timestamp DESC LIMIT @limit
      `),
      searchInChannel: this.db.prepare(`
        SELECT * FROM conversations WHERE channel = @channel AND content LIKE @query
        ORDER BY timestamp DESC LIMIT @limit
      `),
      getThreads: this.db.prepare(`
        SELECT thread_id, channel,
               COUNT(*) as message_count,
               MIN(timestamp) as first_timestamp,
               MAX(timestamp) as last_timestamp
        FROM conversations
        WHERE thread_id IS NOT NULL
        GROUP BY channel, thread_id
        ORDER BY last_timestamp DESC
        LIMIT @limit
      `),
      getThreadsByChannel: this.db.prepare(`
        SELECT thread_id, channel,
               COUNT(*) as message_count,
               MIN(timestamp) as first_timestamp,
               MAX(timestamp) as last_timestamp
        FROM conversations
        WHERE channel = @channel AND thread_id IS NOT NULL
        GROUP BY thread_id
        ORDER BY last_timestamp DESC
        LIMIT @limit
      `),
      getSpeakersForThread: this.db.prepare(`
        SELECT DISTINCT speaker FROM conversations
        WHERE channel = @channel AND thread_id = @threadId
      `),
      getPreviewForThread: this.db.prepare(`
        SELECT content FROM conversations
        WHERE channel = @channel AND thread_id = @threadId
        ORDER BY timestamp ASC LIMIT 1
      `),
      getBySpeaker: this.db.prepare(`
        SELECT * FROM conversations WHERE speaker = @speaker
        ORDER BY timestamp DESC LIMIT @limit
      `),
      getRange: this.db.prepare(`
        SELECT * FROM conversations
        WHERE timestamp >= @start AND timestamp <= @end
        ORDER BY timestamp ASC
      `),
      getRangeByChannel: this.db.prepare(`
        SELECT * FROM conversations
        WHERE channel = @channel AND timestamp >= @start AND timestamp <= @end
        ORDER BY timestamp ASC
      `),
      getAfter: this.db.prepare(`
        SELECT * FROM conversations WHERE id > @afterId ORDER BY id ASC LIMIT @limit
      `),
      count: this.db.prepare('SELECT COUNT(*) as count FROM conversations'),
      countByChannel: this.db.prepare(`
        SELECT channel, COUNT(*) as count FROM conversations GROUP BY channel
      `),
      deleteOlderThan: this.db.prepare('DELETE FROM conversations WHERE timestamp < @cutoff'),
    };
  }

  log(input: LogMessageInput): ConversationMessage {
    const now = new Date().toISOString();
    this.stmts.insert.run({
      channel: input.channel,
      threadId: input.threadId ?? null,
      speaker: input.speaker,
      speakerType: input.speakerType ?? 'user',
      role: input.role ?? 'user',
      content: input.content,
      metadata: JSON.stringify(input.metadata ?? {}),
      timestamp: now,
    });
    const id = this.db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };
    return this.getById(id.id)!;
  }

  logBatch(messages: LogMessageInput[]): void {
    const tx = this.db.transaction((msgs: LogMessageInput[]) => {
      for (const msg of msgs) this.log(msg);
    });
    tx(messages);
  }

  getById(id: number): ConversationMessage | undefined {
    const row = this.stmts.getById.get(id) as any;
    return row ? this.rowToMessage(row) : undefined;
  }

  getByThread(channel: string, threadId: string, limit = 200): ConversationMessage[] {
    return (this.stmts.getByThread.all({ channel, threadId, limit }) as any[]).map(this.rowToMessage);
  }

  getByChannel(channel: string, limit = 50, offset = 0): ConversationMessage[] {
    return (this.stmts.getByChannel.all({ channel, limit, offset }) as any[]).map(this.rowToMessage);
  }

  getRecent(limit = 50): ConversationMessage[] {
    return (this.stmts.getRecent.all({ limit }) as any[]).map(this.rowToMessage);
  }

  getRecentByChannel(channel: string, limit = 50): ConversationMessage[] {
    return (this.stmts.getRecentByChannel.all({ channel, limit }) as any[]).map(this.rowToMessage);
  }

  search(query: string, limit = 30): ConversationMessage[] {
    return (this.stmts.search.all({ query: `%${query}%`, limit }) as any[]).map(this.rowToMessage);
  }

  searchInChannel(channel: string, query: string, limit = 30): ConversationMessage[] {
    return (this.stmts.searchInChannel.all({ channel, query: `%${query}%`, limit }) as any[]).map(this.rowToMessage);
  }

  getThreads(limit = 30): ConversationThread[] {
    const rows = this.stmts.getThreads.all({ limit }) as any[];
    return rows.map(r => this.enrichThread(r));
  }

  getThreadsByChannel(channel: string, limit = 30): ConversationThread[] {
    const rows = this.stmts.getThreadsByChannel.all({ channel, limit }) as any[];
    return rows.map(r => this.enrichThread(r));
  }

  getBySpeaker(speaker: string, limit = 50): ConversationMessage[] {
    return (this.stmts.getBySpeaker.all({ speaker, limit }) as any[]).map(this.rowToMessage);
  }

  getRange(start: string, end: string): ConversationMessage[] {
    return (this.stmts.getRange.all({ start, end }) as any[]).map(this.rowToMessage);
  }

  getRangeByChannel(channel: string, start: string, end: string): ConversationMessage[] {
    return (this.stmts.getRangeByChannel.all({ channel, start, end }) as any[]).map(this.rowToMessage);
  }

  getAfter(afterId: number, limit = 100): ConversationMessage[] {
    return (this.stmts.getAfter.all({ afterId, limit }) as any[]).map(this.rowToMessage);
  }

  count(): number {
    return (this.stmts.count.get() as { count: number }).count;
  }

  countByChannel(): Record<string, number> {
    const rows = this.stmts.countByChannel.all() as { channel: string; count: number }[];
    return Object.fromEntries(rows.map(r => [r.channel, r.count]));
  }

  deleteOlderThan(cutoffIso: string): number {
    return this.stmts.deleteOlderThan.run({ cutoff: cutoffIso }).changes;
  }

  private enrichThread(row: any): ConversationThread {
    const speakers = (this.stmts.getSpeakersForThread.all({
      channel: row.channel, threadId: row.thread_id,
    }) as any[]).map(s => s.speaker);
    const preview = (this.stmts.getPreviewForThread.get({
      channel: row.channel, threadId: row.thread_id,
    }) as any)?.content ?? '';
    return {
      threadId: row.thread_id,
      channel: row.channel,
      messageCount: row.message_count,
      firstTimestamp: row.first_timestamp,
      lastTimestamp: row.last_timestamp,
      speakers,
      preview: preview.slice(0, 200),
    };
  }

  private rowToMessage(row: any): ConversationMessage {
    return {
      id: row.id,
      channel: row.channel,
      threadId: row.thread_id ?? null,
      speaker: row.speaker,
      speakerType: row.speaker_type,
      role: row.role,
      content: row.content,
      metadata: JSON.parse(row.metadata),
      timestamp: row.timestamp,
    };
  }
}
