// Control Plane
export { TaskManager } from './control-plane/task-manager.js';
export { LocalEventBus } from './control-plane/event-bus.js';
export type { EventBus } from './control-plane/event-bus.js';
export { Scheduler } from './control-plane/scheduler.js';
export { PolicyEngine } from './control-plane/policy-engine.js';
export { ApprovalManager } from './control-plane/approval-manager.js';
export {
  TaskStatus, Priority, TaskSchema, CreateTaskInput,
  TaskResultSchema, CheckpointSchema, OrchestratorEventSchema,
  canTransition, assertTransition,
} from './control-plane/task-model.js';
export type { Task, TaskResult, Checkpoint, OrchestratorEvent } from './control-plane/task-model.js';

// Store
export { TaskRepo } from './store/task-repo.js';
export { EventRepo } from './store/event-repo.js';
export { getDb, closeDb, createTestDb } from './store/db.js';

// Execution
export { CopilotSdkAdapter, MockCopilotAdapter } from './execution/copilot-adapter.js';
export type { CopilotAdapter, CopilotSession, SessionOptions } from './execution/copilot-adapter.js';
export { SessionPool } from './execution/session-pool.js';
export { AgentLoader, parseAgentFile, parseAgentContent } from './execution/agent-loader.js';
export type { AgentDefinition } from './execution/agent-loader.js';
export { WorktreeManager } from './execution/worktree-manager.js';
export { ArtifactCollector } from './execution/artifact-collector.js';
export { SessionRunner } from './execution/session-runner.js';
export { TaskDag, buildDagFromTasks, executeDag } from './execution/task-dag.js';
export { MultiRepoCoordinator } from './execution/multi-repo.js';

// Wiki
export { WikiManager } from './wiki/wiki-manager.js';

// Config
export { loadConfig } from './config.js';
export type { Config } from './config.js';
export { paths, ensureDataDirs } from './paths.js';
