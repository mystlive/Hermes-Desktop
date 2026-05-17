import assert from 'node:assert/strict';
import { test } from 'node:test';

import { registerAgentStudioRoutes } from '../routes/agent-studio.mjs';

function createRouteRecorder() {
  const routes = new Map();
  const register = (method) => (route, handler) => {
    routes.set(`${method} ${route}`, handler);
  };

  return {
    routes,
    app: {
      get: register('GET'),
      post: register('POST'),
      patch: register('PATCH'),
      delete: register('DELETE'),
    },
  };
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('agent studio routes keep task runner non-persistent while execute and auto-config stay persisted', async () => {
  const { app, routes } = createRouteRecorder();
  const callbackCalls = [];
  const nonPersistentGateway = async () => ({ mode: 'non-persistent' });
  const persistedGateway = async () => ({ mode: 'persisted' });

  const agentStudioService = {
    previewWorkspaceAutoConfig: async (_hermes, _workspaceId, _payload, runners) => {
      callbackCalls.push({ route: 'auto-config', callback: runners.postGatewayChatCompletion });
      return { success: true };
    },
    executeWorkspace: async (_hermes, _workspaceId, _payload, runners) => {
      callbackCalls.push({ route: 'execute', callback: runners.postGatewayChatCompletion });
      return { success: true };
    },
    runWorkspaceTask: async (_hermes, _workspaceId, _payload, runners) => {
      callbackCalls.push({ route: 'run', callback: runners.postGatewayChatCompletion });
      return { success: true };
    },
  };

  registerAgentStudioRoutes({
    app,
    agentStudioService,
    getHermesContext: async () => ({ profile: 'default' }),
    postGatewayChatCompletion: nonPersistentGateway,
    postPersistedGatewayChatCompletion: persistedGateway,
  });

  const req = { hermes: { profile: 'default' }, params: { id: 'workspace-1' }, body: {} };

  await routes.get('POST /api/agent-studio/workspaces/:id/run')(req, createResponseRecorder());
  await routes.get('POST /api/agent-studio/workspaces/:id/chat')(req, createResponseRecorder());
  await routes.get('POST /api/agent-studio/workspaces/:id/execute')(req, createResponseRecorder());
  await routes.get('POST /api/agent-studio/workspaces/:id/auto-config')(req, createResponseRecorder());

  assert.deepEqual(
    callbackCalls.map(entry => ({ route: entry.route, isNonPersistent: entry.callback === nonPersistentGateway, isPersisted: entry.callback === persistedGateway })),
    [
      { route: 'run', isNonPersistent: true, isPersisted: false },
      { route: 'run', isNonPersistent: true, isPersisted: false },
      { route: 'execute', isNonPersistent: false, isPersisted: true },
      { route: 'auto-config', isNonPersistent: false, isPersisted: true },
    ],
  );
});
