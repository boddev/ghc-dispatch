import { EventEmitter } from 'node:events';
import type { OrchestratorEvent } from './task-model.js';

export interface EventBus {
  emit(event: OrchestratorEvent): void;
  on(type: string, handler: (event: OrchestratorEvent) => void): void;
  off(type: string, handler: (event: OrchestratorEvent) => void): void;
  onAny(handler: (event: OrchestratorEvent) => void): void;
}

export class LocalEventBus implements EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(5000);
  }

  emit(event: OrchestratorEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event);
  }

  on(type: string, handler: (event: OrchestratorEvent) => void): void {
    this.emitter.on(type, handler);
  }

  off(type: string, handler: (event: OrchestratorEvent) => void): void {
    this.emitter.off(type, handler);
  }

  onAny(handler: (event: OrchestratorEvent) => void): void {
    this.emitter.on('*', handler);
  }
}
