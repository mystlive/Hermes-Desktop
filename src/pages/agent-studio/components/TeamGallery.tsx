import { useMemo, useState } from 'react';
import { Loader2, Plus, AlertTriangle, UserCheck, ArrowRight } from 'lucide-react';
import { cn } from '../../../lib/utils';
import {
  TEAMS,
  TEAM_THEMES,
  resolveTeam,
  type TeamDefinition,
  type TeamTheme,
  type TeamThemeId,
} from '../teams/teamDefinitions';
import type { AgentDefinition } from '../../../types';

// ── Color map ─────────────────────────────────────────────────────────

const COLOR_STYLES: Record<string, { bg: string; border: string; badge: string; icon: string }> = {
  blue: {
    bg: 'from-blue-500/10 via-blue-500/5 to-transparent',
    border: 'border-blue-500/20 hover:border-blue-500/40',
    badge: 'bg-blue-500/15 text-blue-400',
    icon: 'text-blue-400',
  },
  red: {
    bg: 'from-red-500/10 via-red-500/5 to-transparent',
    border: 'border-red-500/20 hover:border-red-500/40',
    badge: 'bg-red-500/15 text-red-400',
    icon: 'text-red-400',
  },
  green: {
    bg: 'from-green-500/10 via-green-500/5 to-transparent',
    border: 'border-green-500/20 hover:border-green-500/40',
    badge: 'bg-green-500/15 text-green-400',
    icon: 'text-green-400',
  },
  purple: {
    bg: 'from-purple-500/10 via-purple-500/5 to-transparent',
    border: 'border-purple-500/20 hover:border-purple-500/40',
    badge: 'bg-purple-500/15 text-purple-400',
    icon: 'text-purple-400',
  },
  amber: {
    bg: 'from-amber-500/10 via-amber-500/5 to-transparent',
    border: 'border-amber-500/20 hover:border-amber-500/40',
    badge: 'bg-amber-500/15 text-amber-400',
    icon: 'text-amber-400',
  },
  cyan: {
    bg: 'from-cyan-500/10 via-cyan-500/5 to-transparent',
    border: 'border-cyan-500/20 hover:border-cyan-500/40',
    badge: 'bg-cyan-500/15 text-cyan-400',
    icon: 'text-cyan-400',
  },
  indigo: {
    bg: 'from-indigo-500/10 via-indigo-500/5 to-transparent',
    border: 'border-indigo-500/20 hover:border-indigo-500/40',
    badge: 'bg-indigo-500/15 text-indigo-400',
    icon: 'text-indigo-400',
  },
};

// ── Role badges ───────────────────────────────────────────────────────

const ROLE_BADGE: Record<string, { label: string; className: string }> = {
  orchestrator: { label: 'Lead', className: 'bg-primary/15 text-primary' },
  worker: { label: 'Worker', className: 'bg-muted text-muted-foreground' },
  reviewer: { label: 'Reviewer', className: 'bg-amber-500/15 text-amber-400' },
  qa: { label: 'QA', className: 'bg-green-500/15 text-green-400' },
  observer: { label: 'Observer', className: 'bg-purple-500/15 text-purple-400' },
};

// ── Component ─────────────────────────────────────────────────────────

interface TeamGalleryProps {
  agents: AgentDefinition[];
  loading: boolean;
  onSelectTeam: (team: TeamDefinition) => void;
  onLoadBundled?: () => void;
}

type ActiveTheme = TeamThemeId | 'all';

export function TeamGallery({ agents, loading, onSelectTeam, onLoadBundled }: TeamGalleryProps) {
  const [activeTheme, setActiveTheme] = useState<ActiveTheme>('all');
  const themeCounts = useMemo(() => {
    const counts = new Map<TeamThemeId, number>();
    for (const team of TEAMS) {
      counts.set(team.theme, (counts.get(team.theme) || 0) + 1);
    }
    return counts;
  }, []);
  const sections = useMemo(() => {
    return TEAM_THEMES
      .map(theme => ({
        theme,
        teams: TEAMS.filter(team => team.theme === theme.id),
      }))
      .filter(section => section.teams.length > 0)
      .filter(section => activeTheme === 'all' || section.theme.id === activeTheme);
  }, [activeTheme]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Quick Start Teams</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Choisis une équipe pré-configurée pour ton projet. Chaque team crée un workspace
          avec les bons agents, rôles et relations. Tu pourras tout modifier après.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <ThemeButton
          active={activeTheme === 'all'}
          count={TEAMS.length}
          label="All"
          onClick={() => setActiveTheme('all')}
        />
        {TEAM_THEMES.filter(theme => themeCounts.has(theme.id)).map(theme => (
          <ThemeButton
            key={theme.id}
            active={activeTheme === theme.id}
            count={themeCounts.get(theme.id) || 0}
            label={theme.label}
            onClick={() => setActiveTheme(theme.id)}
          />
        ))}
      </div>

      <div className="space-y-8">
        {sections.map(section => (
          <TeamSection
            key={section.theme.id}
            agents={agents}
            loading={loading}
            onLoadBundled={onLoadBundled}
            onSelectTeam={onSelectTeam}
            teams={section.teams}
            theme={section.theme}
          />
        ))}
      </div>
    </div>
  );
}

function ThemeButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card/50 text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-[10px]',
          active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}

function TeamSection({
  agents,
  loading,
  onLoadBundled,
  onSelectTeam,
  teams,
  theme,
}: {
  agents: AgentDefinition[];
  loading: boolean;
  onLoadBundled?: () => void;
  onSelectTeam: (team: TeamDefinition) => void;
  teams: TeamDefinition[];
  theme: TeamTheme;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">{theme.label}</h3>
          <p className="max-w-2xl text-xs text-muted-foreground">{theme.description}</p>
        </div>
        <span className="text-xs text-muted-foreground">
          {teams.length} team{teams.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {teams.map(team => (
          <TeamCard
            key={team.id}
            team={team}
            agents={agents}
            loading={loading}
            onSelect={() => onSelectTeam(team)}
            onLoadBundled={onLoadBundled}
          />
        ))}
      </div>
    </section>
  );
}

// ── Team Card ─────────────────────────────────────────────────────────

function TeamCard({
  team,
  agents,
  loading,
  onSelect,
  onLoadBundled,
}: {
  team: TeamDefinition;
  agents: AgentDefinition[];
  loading: boolean;
  onSelect: () => void;
  onLoadBundled?: () => void;
}) {
  const colors = COLOR_STYLES[team.color] || COLOR_STYLES.blue;

  const { missingAgents, ambiguousAgents, nodes } = useMemo(
    () => resolveTeam(team, agents),
    [team, agents],
  );
  const hasMissingAgents = missingAgents.length > 0;
  const hasAmbiguousAgents = ambiguousAgents.length > 0;
  const handleActivate = () => {
    if (loading) return;
    if (hasMissingAgents && onLoadBundled) {
      onLoadBundled();
      return;
    }
    onSelect();
  };

  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border bg-gradient-to-br from-card to-card/80 p-5 transition-all',
        colors.border,
        !loading && 'cursor-pointer hover:shadow-md hover:shadow-foreground/5',
        loading && 'opacity-60 pointer-events-none',
      )}
      onClick={loading ? undefined : handleActivate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' && !loading) handleActivate(); }}
    >
      {/* Gradient background */}
      <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-30', colors.bg)} />

      {/* Card content */}
      <div className="relative z-10 flex flex-col gap-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className={cn('text-2xl', colors.icon)}>{team.icon}</span>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-foreground">{team.name}</h3>
              <p className="line-clamp-2 text-xs text-muted-foreground">{team.description}</p>
            </div>
          </div>
        </div>

        {/* Members row */}
        <div className="flex flex-wrap gap-1.5">
          {team.nodes.map((node, i) => {
            const badge = ROLE_BADGE[node.role] || ROLE_BADGE.worker;
            return (
              <span
                key={i}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                  badge.className,
                )}
              >
                {i > 0 && (
                  <ArrowRight size={10} className="mr-0.5 text-muted-foreground/50" />
                )}
                {badge.label}: {node.label || node.agentName}
              </span>
            );
          })}
        </div>

        {/* Missing agents warning */}
        {hasMissingAgents && (
          <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-400">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>
              Agents not found: {missingAgents.join(', ')}. Load bundled templates first.
            </span>
          </div>
        )}

        {hasAmbiguousAgents && (
          <div className="flex items-start gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-300">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>
              Duplicate template names detected for: {ambiguousAgents.map(item => item.agentName).join(', ')}.
              Resolve the duplicate templates before creating this workspace.
            </span>
          </div>
        )}

        {/* Edge count + mode */}
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <UserCheck size={12} />
            {nodes.length} agents · {team.edges.length} relations
          </span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium capitalize">
            {team.defaultMode}
          </span>
        </div>

        {/* Create button */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleActivate(); }}
          disabled={loading}
          className={cn(
            'mt-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
            !hasMissingAgents && !hasAmbiguousAgents
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'border border-border text-muted-foreground hover:bg-muted hover:text-foreground',
            'disabled:opacity-50',
          )}
        >
          {loading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Plus size={15} />
          )}
          {hasMissingAgents ? 'Load templates first' : hasAmbiguousAgents ? 'Resolve duplicate templates' : 'Create workspace'}
        </button>
      </div>
    </div>
  );
}
