import { z } from 'zod';

const PolicyRuleSchema = z.object({
  id: z.string(),
  description: z.string().default(''),
  type: z.enum(['repo_allowlist', 'tool_permission', 'rate_limit', 'approval_required', 'budget']),
  scope: z.object({
    users: z.array(z.string()).default([]),
    agents: z.array(z.string()).default([]),
    repos: z.array(z.string()).default([]),
  }).default({}),
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export interface PolicyEvaluation {
  allowed: boolean;
  reason?: string;
  requiresApproval?: boolean;
  ruleId?: string;
}

export interface PolicyContext {
  user: string;
  agent: string;
  repo?: string;
  action: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
}

export class PolicyEngine {
  private rules: PolicyRule[] = [];

  addRule(rule: PolicyRule): void {
    this.rules.push(PolicyRuleSchema.parse(rule));
  }

  removeRule(ruleId: string): boolean {
    const idx = this.rules.findIndex(r => r.id === ruleId);
    if (idx >= 0) { this.rules.splice(idx, 1); return true; }
    return false;
  }

  getRules(): PolicyRule[] {
    return [...this.rules];
  }

  evaluate(context: PolicyContext): PolicyEvaluation {
    for (const rule of this.rules.filter(r => r.enabled)) {
      if (!this.matchesScope(rule, context)) continue;

      switch (rule.type) {
        case 'repo_allowlist': {
          const allowed = (rule.config.repos as string[]) ?? [];
          if (context.repo && !allowed.some(r => context.repo!.includes(r))) {
            return { allowed: false, reason: `Repo ${context.repo} not in allowlist`, ruleId: rule.id };
          }
          break;
        }

        case 'tool_permission': {
          const denied = (rule.config.deniedTools as string[]) ?? [];
          if (context.toolName && denied.includes(context.toolName)) {
            return { allowed: false, reason: `Tool ${context.toolName} is denied by policy`, ruleId: rule.id };
          }
          break;
        }

        case 'approval_required': {
          const actions = (rule.config.actions as string[]) ?? [];
          if (actions.includes(context.action) || actions.includes('*')) {
            return { allowed: true, requiresApproval: true, ruleId: rule.id };
          }
          break;
        }

        case 'rate_limit': {
          // Rate limiting is checked externally by the scheduler
          break;
        }

        case 'budget': {
          // Budget checks are handled by the budget controller
          break;
        }
      }
    }

    return { allowed: true };
  }

  private matchesScope(rule: PolicyRule, context: PolicyContext): boolean {
    const { users, agents, repos } = rule.scope;
    if (users.length > 0 && !users.includes(context.user) && !users.includes('*')) return false;
    if (agents.length > 0 && !agents.includes(context.agent) && !agents.includes('*')) return false;
    if (repos.length > 0 && context.repo && !repos.some(r => context.repo!.includes(r)) && !repos.includes('*')) return false;
    return true;
  }
}
