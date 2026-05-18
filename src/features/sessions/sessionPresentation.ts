import type { SessionEntry } from '../../types';

const SESSION_SOURCE_LABELS: Record<string, string> = {
  'api-server': 'Chat',
  cli: 'CLI',
  'agent-studio-workspace': 'Workspace chat draft',
  'agent-studio-workspace-task-runner': 'Workspace run',
  'agent-studio-delegate': 'Workspace delegate run',
  'agent-studio-profile-runtime': 'Workspace profile run',
  'agent-studio-auto-config': 'Workspace auto-config',
};

const HOME_HIDDEN_SOURCES = new Set([
  'agent-studio-auto-config',
]);

function normalizeSource(source?: string | null) {
  return String(source || '').trim().toLowerCase();
}

function humanizeSource(source: string) {
  const cleaned = source.replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return 'Unknown';
  return cleaned.replace(/\b\w/g, char => char.toUpperCase());
}

export function formatSessionSourceLabel(source?: string | null) {
  const normalized = normalizeSource(source);
  if (!normalized) return 'Unknown';
  return SESSION_SOURCE_LABELS[normalized] || humanizeSource(normalized);
}

export function shouldShowSessionOnHome(session: SessionEntry) {
  return !HOME_HIDDEN_SOURCES.has(normalizeSource(session.source));
}
