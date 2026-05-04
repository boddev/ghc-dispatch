import { describe, expect, it } from 'vitest';
import { toCopilotRuntimePermissionResponse } from '../../src/execution/copilot-adapter.js';

describe('Copilot adapter permissions', () => {
  it('approves requests with the runtime permission response shape', () => {
    expect(toCopilotRuntimePermissionResponse(true)).toEqual({ kind: 'approve-once' });
  });

  it('rejects denied requests with the runtime permission response shape', () => {
    expect(toCopilotRuntimePermissionResponse(false)).toEqual({
      kind: 'reject',
      feedback: 'Denied by Dispatch runtime configuration.',
    });
  });
});
