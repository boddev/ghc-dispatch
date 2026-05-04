import type Database from 'better-sqlite3';
import { ulid } from 'ulid';

export interface AgentTeam {
  id: string;
  name: string;
  description: string;
  leadAgent: string;
  memberAgents: string[];
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface CreateAgentTeamInput {
  name: string;
  description?: string;
  leadAgent: string;
  memberAgents: string[];
  metadata?: Record<string, unknown>;
}

export class TeamRepo {
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(private db: Database.Database) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insert: this.db.prepare(`
        INSERT INTO agent_teams (id, name, description, lead_agent, member_agents, created_at, updated_at, metadata)
        VALUES (@id, @name, @description, @leadAgent, @memberAgents, @createdAt, @updatedAt, @metadata)
      `),
      getById: this.db.prepare('SELECT * FROM agent_teams WHERE id = ?'),
      listAll: this.db.prepare('SELECT * FROM agent_teams ORDER BY name'),
      remove: this.db.prepare('DELETE FROM agent_teams WHERE id = ?'),
    };
  }

  create(input: CreateAgentTeamInput): AgentTeam {
    const now = new Date().toISOString();
    const id = ulid();
    this.stmts.insert.run({
      id,
      name: input.name,
      description: input.description ?? '',
      leadAgent: normalizeAgent(input.leadAgent),
      memberAgents: JSON.stringify([...new Set(input.memberAgents.map(normalizeAgent))]),
      createdAt: now,
      updatedAt: now,
      metadata: JSON.stringify(input.metadata ?? {}),
    });
    return this.getById(id)!;
  }

  getById(id: string): AgentTeam | undefined {
    const row = this.stmts.getById.get(id) as any;
    return row ? this.rowToTeam(row) : undefined;
  }

  listAll(): AgentTeam[] {
    return (this.stmts.listAll.all() as any[]).map(row => this.rowToTeam(row));
  }

  remove(id: string): boolean {
    return this.stmts.remove.run(id).changes > 0;
  }

  private rowToTeam(row: any): AgentTeam {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      leadAgent: row.lead_agent,
      memberAgents: JSON.parse(row.member_agents),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: JSON.parse(row.metadata),
    };
  }
}

function normalizeAgent(agent: string): string {
  return agent.startsWith('@') ? agent : `@${agent}`;
}
