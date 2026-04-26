import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEngine, type PolicyContext } from '../../src/control-plane/policy-engine.js';

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  it('allows everything by default (no rules)', () => {
    const result = engine.evaluate({ user: 'alice', agent: '@coder', action: 'execute' });
    expect(result.allowed).toBe(true);
  });

  it('blocks repos not in allowlist', () => {
    engine.addRule({
      id: 'repo-restrict',
      type: 'repo_allowlist',
      config: { repos: ['org/allowed-repo'] },
    });

    const blocked = engine.evaluate({ user: 'alice', agent: '@coder', action: 'execute', repo: 'org/secret-repo' });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('not in allowlist');

    const allowed = engine.evaluate({ user: 'alice', agent: '@coder', action: 'execute', repo: 'org/allowed-repo' });
    expect(allowed.allowed).toBe(true);
  });

  it('blocks denied tools', () => {
    engine.addRule({
      id: 'no-deploy',
      type: 'tool_permission',
      config: { deniedTools: ['deploy', 'rm_rf'] },
    });

    const blocked = engine.evaluate({ user: 'alice', agent: '@coder', action: 'tool_call', toolName: 'deploy' });
    expect(blocked.allowed).toBe(false);

    const allowed = engine.evaluate({ user: 'alice', agent: '@coder', action: 'tool_call', toolName: 'file_read' });
    expect(allowed.allowed).toBe(true);
  });

  it('requires approval for specified actions', () => {
    engine.addRule({
      id: 'approve-deploys',
      type: 'approval_required',
      config: { actions: ['deploy'] },
    });

    const result = engine.evaluate({ user: 'alice', agent: '@coder', action: 'deploy' });
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  it('scopes rules to specific users', () => {
    engine.addRule({
      id: 'intern-restrict',
      type: 'tool_permission',
      scope: { users: ['intern'], agents: [], repos: [] },
      config: { deniedTools: ['git_push'] },
    });

    const intern = engine.evaluate({ user: 'intern', agent: '@coder', action: 'tool_call', toolName: 'git_push' });
    expect(intern.allowed).toBe(false);

    const senior = engine.evaluate({ user: 'senior', agent: '@coder', action: 'tool_call', toolName: 'git_push' });
    expect(senior.allowed).toBe(true);
  });

  it('scopes rules to specific agents', () => {
    engine.addRule({
      id: 'designer-no-terminal',
      type: 'tool_permission',
      scope: { users: [], agents: ['@designer'], repos: [] },
      config: { deniedTools: ['terminal'] },
    });

    const designer = engine.evaluate({ user: 'alice', agent: '@designer', action: 'tool_call', toolName: 'terminal' });
    expect(designer.allowed).toBe(false);

    const coder = engine.evaluate({ user: 'alice', agent: '@coder', action: 'tool_call', toolName: 'terminal' });
    expect(coder.allowed).toBe(true);
  });

  it('removes rules', () => {
    engine.addRule({ id: 'temp', type: 'tool_permission', config: { deniedTools: ['x'] } });
    expect(engine.getRules()).toHaveLength(1);
    expect(engine.removeRule('temp')).toBe(true);
    expect(engine.getRules()).toHaveLength(0);
  });

  it('disabled rules are skipped', () => {
    engine.addRule({
      id: 'disabled',
      type: 'tool_permission',
      config: { deniedTools: ['everything'] },
      enabled: false,
    });

    const result = engine.evaluate({ user: 'alice', agent: '@coder', action: 'tool_call', toolName: 'everything' });
    expect(result.allowed).toBe(true);
  });
});
