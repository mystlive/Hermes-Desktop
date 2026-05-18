/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as api from '../../api';
import { useProfiles } from '../../contexts/ProfileContext';
import type { SessionEntry, SessionResumeRecap, SessionStats } from '../../types';

type SessionMap = Record<string, SessionEntry>;
type CreateSessionPayload = Parameters<typeof api.sessions.create>[0];
type ResumeSessionPayload = Parameters<typeof api.sessions.resume>[0];
type ContinueSessionPayload = Parameters<typeof api.sessions.continue>[1];
type AppendSessionMessagesPayload = Parameters<typeof api.sessions.appendMessages>[1];
type PruneSessionsPayload = Parameters<typeof api.sessions.prune>[0];

interface SessionsContextValue {
  sessions: SessionMap;
  stats: SessionStats | null;
  isLoading: boolean;
  isRefreshing: boolean;
  refreshSessions: (options?: { silent?: boolean }) => Promise<SessionMap>;
  refreshStats: (options?: { silent?: boolean }) => Promise<SessionStats | null>;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  createSession: (payload?: CreateSessionPayload) => Promise<SessionEntry | null>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  resumeSession: (payload: ResumeSessionPayload) => Promise<{ session: SessionEntry; recap?: SessionResumeRecap } | null>;
  continueSession: (id: string, payload?: ContinueSessionPayload) => Promise<SessionEntry | null>;
  appendMessages: (id: string, payload: AppendSessionMessagesPayload) => Promise<void>;
  pruneSessions: (payload?: PruneSessionsPayload) => Promise<{ success: true; deleted: number; older_than_days: number; source?: string | null } | null>;
}

const SessionsContext = createContext<SessionsContextValue | null>(null);

function normalizeSessionMap(input: unknown): SessionMap {
  if (!input || typeof input !== 'object') return {};
  const next: SessionMap = {};
  for (const [id, value] of Object.entries(input as Record<string, SessionEntry>)) {
    next[id] = {
      ...(value || {}),
      id,
    };
  }
  return next;
}

function normalizeSessionEntry(entry: SessionEntry | null | undefined, fallbackId?: string | null): SessionEntry | null {
  const id = String(entry?.id || fallbackId || '').trim();
  if (!id) return null;
  return {
    ...(entry || {}),
    id,
  };
}

function upsertSession(current: SessionMap, entry: SessionEntry | null | undefined, fallbackId?: string | null): SessionMap {
  const normalized = normalizeSessionEntry(entry, fallbackId);
  if (!normalized) return current;
  const sessionId = String(normalized.id);
  return {
    ...current,
    [sessionId]: {
      ...(current[sessionId] || {}),
      ...normalized,
      id: sessionId,
    },
  };
}

function patchSession(current: SessionMap, sessionId: string, patch: Partial<SessionEntry>): SessionMap {
  const id = String(sessionId || '').trim();
  if (!id) return current;
  return {
    ...current,
    [id]: {
      ...(current[id] || { id }),
      ...patch,
      id,
    },
  };
}

function removeSession(current: SessionMap, sessionId: string): SessionMap {
  if (!Object.prototype.hasOwnProperty.call(current, sessionId)) return current;
  const next = { ...current };
  delete next[sessionId];
  return next;
}

function adjustStats(
  current: SessionStats | null,
  deltas: { totalSessions?: number; totalMessages?: number },
): SessionStats | null {
  if (!current) return current;
  return {
    ...current,
    total_sessions: Math.max(0, current.total_sessions + (deltas.totalSessions || 0)),
    total_messages: Math.max(0, current.total_messages + (deltas.totalMessages || 0)),
  };
}

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { currentProfile } = useProfiles();
  const [sessions, setSessions] = useState<SessionMap>({});
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshCount, setRefreshCount] = useState(0);
  const sessionsRequestRef = useRef(0);
  const statsRequestRef = useRef(0);
  const sessionsRef = useRef<SessionMap>({});

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const withRefreshFlag = useCallback((silent?: boolean) => {
    if (silent) {
      return () => {};
    }
    setRefreshCount(current => current + 1);
    return () => {
      setRefreshCount(current => Math.max(0, current - 1));
    };
  }, []);

  const refreshSessions = useCallback(async (options?: { silent?: boolean }) => {
    const finish = withRefreshFlag(options?.silent);
    const requestId = ++sessionsRequestRef.current;
    try {
      const response = await api.sessions.list();
      const next = normalizeSessionMap(response.data);
      if (sessionsRequestRef.current === requestId) {
        setSessions(next);
      }
      return next;
    } catch {
      if (sessionsRequestRef.current === requestId) {
        setSessions({});
      }
      return {};
    } finally {
      finish();
    }
  }, [withRefreshFlag]);

  const refreshStats = useCallback(async (options?: { silent?: boolean }) => {
    const finish = withRefreshFlag(options?.silent);
    const requestId = ++statsRequestRef.current;
    try {
      const response = await api.sessions.stats();
      const next = response.data || null;
      if (statsRequestRef.current === requestId) {
        setStats(next);
      }
      return next;
    } catch {
      if (statsRequestRef.current === requestId) {
        setStats(null);
      }
      return null;
    } finally {
      finish();
    }
  }, [withRefreshFlag]);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    await Promise.all([
      refreshSessions(options),
      refreshStats(options),
    ]);
  }, [refreshSessions, refreshStats]);

  useEffect(() => {
    let cancelled = false;
    setSessions({});
    setStats(null);
    setIsLoading(true);
    void Promise.all([
      refreshSessions({ silent: true }),
      refreshStats({ silent: true }),
    ]).finally(() => {
      if (!cancelled) {
        setIsLoading(false);
      }
    });

    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentProfile, refresh, refreshSessions, refreshStats]);

  const createSession = useCallback(async (payload?: CreateSessionPayload) => {
    const response = await api.sessions.create(payload);
    const created = normalizeSessionEntry(response.data);
    if (created?.id) {
      const sessionId = String(created.id);
      const isNewSession = !Object.prototype.hasOwnProperty.call(sessionsRef.current, sessionId);
      setSessions(current => upsertSession(current, created));
      if (isNewSession) {
        setStats(current => adjustStats(current, { totalSessions: 1 }));
      }
    }
    void refreshStats({ silent: true });
    return created;
  }, [refreshStats]);

  const renameSession = useCallback(async (id: string, title: string) => {
    await api.sessions.rename(id, title);
    setSessions(current => patchSession(current, id, {
      title,
      last_accessed: Date.now(),
    }));
    void refreshSessions({ silent: true });
  }, [refreshSessions]);

  const deleteSession = useCallback(async (id: string) => {
    const existed = Object.prototype.hasOwnProperty.call(sessionsRef.current, id);
    await api.sessions.delete(id);
    setSessions(current => removeSession(current, id));
    if (existed) {
      setStats(current => adjustStats(current, { totalSessions: -1 }));
    }
    void refreshStats({ silent: true });
  }, [refreshStats]);

  const resumeSession = useCallback(async (payload: ResumeSessionPayload) => {
    const response = await api.sessions.resume(payload);
    const resumed = normalizeSessionEntry(response.data?.session);
    if (resumed?.id) {
      setSessions(current => upsertSession(current, resumed));
    }
    void refreshSessions({ silent: true });
    return resumed ? { ...response.data, session: resumed } : null;
  }, [refreshSessions]);

  const continueSession = useCallback(async (id: string, payload?: ContinueSessionPayload) => {
    const response = await api.sessions.continue(id, payload);
    const created = normalizeSessionEntry(response.data);
    if (created?.id) {
      const sessionId = String(created.id);
      const isNewSession = !Object.prototype.hasOwnProperty.call(sessionsRef.current, sessionId);
      setSessions(current => upsertSession(current, created));
      if (isNewSession) {
        setStats(current => adjustStats(current, { totalSessions: 1 }));
      }
    }
    void refreshStats({ silent: true });
    return created;
  }, [refreshStats]);

  const appendMessages = useCallback(async (id: string, payload: AppendSessionMessagesPayload) => {
    await api.sessions.appendMessages(id, payload);
    const appendedCount = Array.isArray(payload.messages) ? payload.messages.length : 0;
    setSessions(current => patchSession(current, id, {
      model: payload.model,
      source: payload.source,
      workspace_id: payload.workspace_id,
      workspace_name: payload.workspace_name,
      last_accessed: Date.now(),
    }));
    if (appendedCount > 0) {
      setStats(current => adjustStats(current, { totalMessages: appendedCount }));
    }
    void refresh({ silent: true });
  }, [refresh]);

  const pruneSessions = useCallback(async (payload?: PruneSessionsPayload) => {
    const response = await api.sessions.prune(payload);
    const deleted = Number(response.data?.deleted || 0);
    if (deleted > 0) {
      setStats(current => adjustStats(current, { totalSessions: -deleted }));
    }
    await refresh({ silent: true });
    return response.data || null;
  }, [refresh]);

  const value = useMemo<SessionsContextValue>(() => ({
    sessions,
    stats,
    isLoading,
    isRefreshing: refreshCount > 0,
    refreshSessions,
    refreshStats,
    refresh,
    createSession,
    renameSession,
    deleteSession,
    resumeSession,
    continueSession,
    appendMessages,
    pruneSessions,
  }), [
    appendMessages,
    continueSession,
    createSession,
    deleteSession,
    isLoading,
    pruneSessions,
    refresh,
    refreshCount,
    refreshSessions,
    refreshStats,
    renameSession,
    resumeSession,
    sessions,
    stats,
  ]);

  return (
    <SessionsContext.Provider value={value}>
      {children}
    </SessionsContext.Provider>
  );
}

export function useSessions(): SessionsContextValue {
  const context = useContext(SessionsContext);
  if (!context) {
    throw new Error('useSessions must be used within <SessionsProvider>');
  }
  return context;
}
