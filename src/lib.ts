export { TaskManager } from './control-plane/task-manager.js';
export { LocalEventBus } from './control-plane/event-bus.js';
export type { EventBus } from './control-plane/event-bus.js';
export {
  TaskStatus,
  Priority,
  TaskSchema,
  CreateTaskInput,
  TaskResultSchema,
  CheckpointSchema,
  OrchestratorEventSchema,
  canTransition,
  assertTransition,
} from './control-plane/task-model.js';
export type {
  Task,
  TaskResult,
  Checkpoint,
  OrchestratorEvent,
} from './control-plane/task-model.js';
export { TaskRepo } from './store/task-repo.js';
export { EventRepo } from './store/event-repo.js';
export { getDb, closeDb, createTestDb } from './store/db.js';
export { CopilotSdkAdapter, MockCopilotAdapter } from './execution/copilot-adapter.js';
export type { CopilotAdapter, CopilotSession, SessionOptions } from './execution/copilot-adapter.js';
export { SessionPool } from './execution/session-pool.js';
export { loadConfig } from './config.js';
export type { Config } from './config.js';
export { paths, ensureDataDirs } from './paths.js';
