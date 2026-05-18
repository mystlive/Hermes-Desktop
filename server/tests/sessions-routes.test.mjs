import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { registerSessionRoutes } from '../routes/sessions.mjs';
import { createStateDbManager } from '../services/state-db.mjs';
import {
  buildResumeRecap,
  createContinuationSession,
  getLatestSessionByTitleVariant,
  getSessionById,
  insertMessages,
  makeSessionId,
  nowTs,
  sanitizeSessionTitle,
  upsertSession,
} from '../services/session-store.mjs';

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

async function withHermesContext(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-session-routes-'));
  const stateDbPath = path.join(tempDir, 'state', 'state.db');
  const sessionsDir = path.join(tempDir, 'sessions');
  const manager = createStateDbManager();
  const hermes = {
    db: manager.getStateDb(stateDbPath),
    paths: {
      stateDb: stateDbPath,
      sessionsDir,
    },
  };

  try {
    await fs.mkdir(sessionsDir, { recursive: true });
    await run({ hermes, stateDbPath });
  } finally {
    manager.closeStateDb(stateDbPath);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function registerRoutes() {
  const { app, routes } = createRouteRecorder();
  registerSessionRoutes({
    app,
    fs,
    path,
    buildResumeRecap,
    createContinuationSession,
    getLatestSessionByTitleVariant,
    getSessionById,
    insertMessages,
    makeSessionId,
    nowTs,
    sanitizeSessionTitle,
    upsertSession,
  });
  return routes;
}

test('session routes export, stats, and prune respect persisted workspace run sources', async () => {
  await withHermesContext(async ({ hermes }) => {
    const routes = registerRoutes();
    const recentTs = nowTs();
    const oldTs = recentTs - (45 * 24 * 60 * 60 * 1000);

    upsertSession(hermes, 'workspace-run', {
      source: 'agent-studio-workspace-task-runner',
      title: 'Workspace Task Run: Atlas',
      model: 'gpt-test',
      workspaceId: 'workspace_atlas',
      workspaceName: 'Atlas',
      startedAt: recentTs,
      endedAt: recentTs,
    });
    insertMessages(hermes, 'workspace-run', [
      { role: 'user', content: 'Workspace run requested for Atlas.' },
      {
        role: 'assistant',
        content: 'Workspace run for Atlas completed in prompt mode.',
        tool_name: 'workspace_run',
        tool_results: { type: 'workspace_run', mode: 'prompt', status: 'completed' },
      },
    ]);

    upsertSession(hermes, 'profile-run-old', {
      source: 'agent-studio-profile-runtime',
      title: 'Workspace Profile Runtime: Atlas',
      model: 'gpt-test',
      workspaceId: 'workspace_atlas',
      workspaceName: 'Atlas',
      startedAt: oldTs,
      endedAt: oldTs,
    });
    hermes.db.prepare('UPDATE sessions SET started_at = ?, updated_at = ?, ended_at = ? WHERE id = ?')
      .run(oldTs, oldTs, oldTs, 'profile-run-old');

    upsertSession(hermes, 'chat-session', {
      source: 'api-server',
      title: 'Main Chat',
      model: 'gpt-test',
      startedAt: recentTs,
      endedAt: recentTs,
    });

    const exportRes = createResponseRecorder();
    await routes.get('POST /api/sessions/export')({
      hermes,
      body: {
        source: 'agent-studio-workspace-task-runner',
        workspace_id: 'workspace_atlas',
      },
    }, exportRes);

    assert.equal(exportRes.statusCode, 200);
    assert.equal(exportRes.body.count, 1);
    assert.equal(Array.isArray(exportRes.body.items), true);
    const exported = JSON.parse(exportRes.body.items[0]);
    assert.equal(exported.id, 'workspace-run');
    assert.equal(exported.source, 'agent-studio-workspace-task-runner');
    assert.equal(exported.workspace_id, 'workspace_atlas');
    assert.equal(exported.workspace_name, 'Atlas');
    assert.equal(exported.messages[1].tool_results.type, 'workspace_run');

    const statsRes = createResponseRecorder();
    await routes.get('GET /api/sessions/stats')({ hermes }, statsRes);

    assert.equal(statsRes.statusCode, 200);
    assert.equal(statsRes.body.total_sessions, 3);
    assert.equal(
      statsRes.body.by_source.find(item => item.source === 'agent-studio-workspace-task-runner')?.count,
      1,
    );
    assert.equal(
      statsRes.body.by_workspace.find(item => item.workspace_id === 'workspace_atlas')?.count,
      2,
    );

    const pruneRes = createResponseRecorder();
    await routes.get('POST /api/sessions/prune')({
      hermes,
      body: {
        older_than_days: 30,
        source: 'agent-studio-profile-runtime',
      },
    }, pruneRes);

    assert.equal(pruneRes.statusCode, 200);
    assert.equal(pruneRes.body.deleted, 1);

    const listRes = createResponseRecorder();
    await routes.get('GET /api/sessions')({ hermes }, listRes);

    assert.equal(Boolean(listRes.body['workspace-run']), true);
    assert.equal(Boolean(listRes.body['profile-run-old']), false);
    assert.equal(Boolean(listRes.body['chat-session']), true);
  });
});

test('session routes rename, continue, resume, and delete preserve workspace run lineage', async () => {
  await withHermesContext(async ({ hermes }) => {
    const routes = registerRoutes();

    upsertSession(hermes, 'delegate-run', {
      source: 'agent-studio-delegate',
      title: 'Workspace Delegate: Atlas',
      model: 'gpt-test',
      workspaceId: 'workspace_atlas',
      workspaceName: 'Atlas',
      startedAt: nowTs(),
    });
    insertMessages(hermes, 'delegate-run', [
      { role: 'user', content: 'Delegate the Atlas workspace.' },
      { role: 'assistant', content: 'Delegation complete.' },
    ]);

    const renameRes = createResponseRecorder();
    await routes.get('POST /api/sessions/:id/rename')({
      hermes,
      params: { id: 'delegate-run' },
      body: { title: 'Atlas delegate run' },
    }, renameRes);

    assert.equal(renameRes.statusCode, 200);
    assert.equal(renameRes.body.title, 'Atlas delegate run');
    assert.equal(getSessionById(hermes, 'delegate-run')?.title, 'Atlas delegate run');

    const continueRes = createResponseRecorder();
    await routes.get('POST /api/sessions/:id/continue')({
      hermes,
      params: { id: 'delegate-run' },
      body: {},
    }, continueRes);

    assert.equal(continueRes.statusCode, 200);
    assert.equal(continueRes.body.parent_session_id, 'delegate-run');
    assert.equal(continueRes.body.source, 'agent-studio-delegate');
    assert.equal(continueRes.body.workspace_id, 'workspace_atlas');
    assert.equal(continueRes.body.workspace_name, 'Atlas');

    const resumeRes = createResponseRecorder();
    await routes.get('POST /api/sessions/resume')({
      hermes,
      body: { mode: 'resume', value: 'delegate-run' },
    }, resumeRes);

    assert.equal(resumeRes.statusCode, 200);
    assert.equal(resumeRes.body.session.id, 'delegate-run');
    assert.equal(resumeRes.body.session.workspace_id, 'workspace_atlas');
    assert.equal(resumeRes.body.recap.mode, 'full');
    assert.equal(resumeRes.body.recap.exchanges.length, 1);
    assert.match(resumeRes.body.recap.exchanges[0].assistant, /Delegation complete/);

    const childId = continueRes.body.id;
    const deleteRes = createResponseRecorder();
    await routes.get('DELETE /api/sessions/:id')({
      hermes,
      params: { id: childId },
    }, deleteRes);

    assert.equal(deleteRes.statusCode, 200);
    assert.equal(deleteRes.body.success, true);
    assert.equal(getSessionById(hermes, childId), undefined);
  });
});
