import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DndContext, type DragEndEvent, type Modifier } from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { ArrowLeftRight, Clock3, FolderKanban, Layers, Loader2, MessageSquare, Pencil, Play, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as api from '../../api';
import { useFeedback } from '../../contexts/FeedbackContext';
import { useTemplatesLibrary } from '../../features/templates/hooks/useTemplatesLibrary';
import { useNavigationGuard } from '../../contexts/NavigationGuardContext';
import { cn } from '../../lib/utils';
import { WorkspaceEditorPanel } from './components/WorkspaceEditorPanel';
import { WorkspaceEmptyState } from './components/WorkspaceEmptyState';
import { WorkspaceInterfacePanel } from './components/WorkspaceInterfacePanel';
import { WorkspaceListPanel } from './components/WorkspaceListPanel';
import { WorkspaceNodeTable } from './components/WorkspaceNodeTable';
import { WorkspaceRunPanel } from './components/WorkspaceRunPanel';
import { WorkspaceTemplatePanel } from './components/WorkspaceTemplatePanel';
import { TeamGallery } from './components/TeamGallery';
import { resolveTeam } from './teams/teamDefinitions';
import type { TeamDefinition } from './teams/teamDefinitions';
import { useWorkspaceCrud } from './hooks/useWorkspaceCrud';
import { useWorkspaceExecution } from './hooks/useWorkspaceExecution';
import type {
  AgentDefinition,
  AgentWorkspace,
  AgentWorkspaceExecutionResult,
  WorkspaceAgentEdge,
  WorkspaceAutoConfigDiffItem,
  WorkspaceAutoConfigPlan,
  WorkspaceAutoConfigPreviewResult,
} from '../../types';

type WorkspaceTab = 'canvas' | 'interface' | 'runs';

type AgentStudioWorkspacesProps = {
  onOpenSessionInChat?: (sessionId: string | null) => void;
};

const WORKSPACE_FIELD_LABELS = {
  description: 'Description',
  pipelineBrief: 'Pipeline brief',
  sharedContext: 'Shared context',
  commonRules: 'Common rules',
} as const;

const NODE_FIELD_LABELS = {
  role: 'Role',
  label: 'Label',
  profileName: 'Profile',
  modelOverride: 'Model',
  skills: 'Skills',
  toolsets: 'Toolsets',
} as const;

function hasOwn(value: unknown, key: string) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function formatDiffValue(value: unknown) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(empty)';
  const text = String(value ?? '').trim();
  return text || '(empty)';
}

function valuesEqual(left: unknown, right: unknown) {
  return formatDiffValue(left) === formatDiffValue(right);
}

function sanitizeEdgeIdPart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'node';
}

function makeAutoConfigEdgeId(edge: Omit<WorkspaceAgentEdge, 'id'>, index: number) {
  return [
    'edge_auto',
    String(index),
    sanitizeEdgeIdPart(edge.fromNodeId),
    sanitizeEdgeIdPart(edge.toNodeId),
    sanitizeEdgeIdPart(edge.kind),
  ].join('_');
}

function edgeSignature(edge: Omit<WorkspaceAgentEdge, 'id'>) {
  return [
    edge.fromNodeId,
    edge.toNodeId,
    edge.kind,
    String(edge.template || '').trim(),
  ].join('::');
}

function edgeSetSignature(edges: Array<Omit<WorkspaceAgentEdge, 'id'>>) {
  return edges.map(edgeSignature).sort().join('|');
}

function getWorkspaceNodeLabel(node: AgentWorkspace['nodes'][number], agentsById: Map<string, AgentDefinition>) {
  return node.label || agentsById.get(node.agentId)?.name || node.id;
}

function formatEdgeForDiff(
  edge: Omit<WorkspaceAgentEdge, 'id'>,
  nodesById: Map<string, AgentWorkspace['nodes'][number]>,
  agentsById: Map<string, AgentDefinition>,
) {
  const from = nodesById.get(edge.fromNodeId);
  const to = nodesById.get(edge.toNodeId);
  const fromLabel = from ? getWorkspaceNodeLabel(from, agentsById) : edge.fromNodeId;
  const toLabel = to ? getWorkspaceNodeLabel(to, agentsById) : edge.toNodeId;
  const template = String(edge.template || '').trim();
  return template
    ? `${fromLabel} -> ${toLabel} (${edge.kind}) - ${template}`
    : `${fromLabel} -> ${toLabel} (${edge.kind})`;
}

function buildWorkspaceAutoConfigPlan(
  workspace: AgentWorkspace,
  preview: WorkspaceAutoConfigPreviewResult,
  agentsById: Map<string, AgentDefinition>,
): WorkspaceAutoConfigPlan {
  const suggestion = preview.suggestion;
  const workspacePatch = suggestion.workspacePatch || {};
  const items: WorkspaceAutoConfigDiffItem[] = [];
  const nodesById = new Map(workspace.nodes.map(node => [node.id, node] as const));
  const patch: WorkspaceAutoConfigPlan['patch'] = {
    nodes: workspace.nodes,
    edges: workspace.edges || [],
  };

  for (const field of Object.keys(WORKSPACE_FIELD_LABELS) as Array<keyof typeof WORKSPACE_FIELD_LABELS>) {
    if (!hasOwn(workspacePatch, field)) continue;
    const nextValue = workspacePatch[field];
    if (valuesEqual(workspace[field], nextValue)) continue;
    patch[field] = nextValue;
    items.push({
      id: `workspace:${field}`,
      category: 'workspace',
      title: WORKSPACE_FIELD_LABELS[field],
      before: formatDiffValue(workspace[field]),
      after: formatDiffValue(nextValue),
    });
  }

  if (hasOwn(workspacePatch, 'defaultMode') && !valuesEqual(workspace.defaultMode, workspacePatch.defaultMode)) {
    patch.defaultMode = workspacePatch.defaultMode;
    items.push({
      id: 'workspace:defaultMode',
      category: 'mode',
      title: 'Execution mode',
      before: formatDiffValue(workspace.defaultMode),
      after: formatDiffValue(workspacePatch.defaultMode),
    });
  }

  const nodePatchesById = new Map((suggestion.nodes || []).map(nodePatch => [nodePatch.nodeId, nodePatch] as const));
  const nodes = workspace.nodes.map(node => {
    const nodePatch = nodePatchesById.get(node.id);
    if (!nodePatch) return node;

    let nextNode = node;
    for (const field of Object.keys(NODE_FIELD_LABELS) as Array<keyof typeof NODE_FIELD_LABELS>) {
      if (!hasOwn(nodePatch, field)) continue;
      const nextValue = nodePatch[field];
      if (valuesEqual(node[field], nextValue)) continue;
      nextNode = { ...nextNode, [field]: nextValue };
      items.push({
        id: `node:${node.id}:${field}`,
        category: 'node',
        title: `${getWorkspaceNodeLabel(node, agentsById)}: ${NODE_FIELD_LABELS[field]}`,
        before: formatDiffValue(node[field]),
        after: formatDiffValue(nextValue),
      });
    }

    return nextNode;
  });
  patch.nodes = nodes;

  const suggestedEdges = suggestion.edges || [];
  let edges = workspace.edges || [];
  if (suggestedEdges.length > 0) {
    const nextEdges = suggestedEdges.map((edge, index) => ({
      id: makeAutoConfigEdgeId(edge, index),
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      kind: edge.kind,
      ...(edge.template ? { template: edge.template } : {}),
    }));
    const currentSignature = edgeSetSignature(edges);
    const nextSignature = edgeSetSignature(nextEdges);

    if (currentSignature !== nextSignature) {
      edges = nextEdges;
      items.push({
        id: 'edges:replace',
        category: 'edge',
        title: 'Relations',
        before: `${workspace.edges?.length || 0} current relation(s)`,
        after: `${nextEdges.length} suggested relation(s)`,
        detail: 'Existing relations will be replaced by the preview.',
      });
      nextEdges.forEach((edge, index) => {
        items.push({
          id: `edge:${index}:${edgeSignature(edge)}`,
          category: 'edge',
          title: `Suggested relation ${index + 1}`,
          after: formatEdgeForDiff(edge, nodesById, agentsById),
        });
      });
    }
  }
  patch.edges = edges;

  return {
    patch,
    nextWorkspace: {
      ...workspace,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
    items,
    hasChanges: items.length > 0,
  };
}

export function AgentStudioWorkspaces({ onOpenSessionInChat }: AgentStudioWorkspacesProps) {
  const navigate = useNavigate();
  const { confirm } = useFeedback();
  const { registerGuard } = useNavigationGuard();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'quick' | 'advanced'>('quick');
  const [creatingFromTeam, setCreatingFromTeam] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('canvas');
  const [viewMode, setViewMode] = useState<'canvas' | 'table'>('canvas');
  const [canvasZoom, setCanvasZoom] = useState(1);
  const canvasZoomRef = useRef(1);
  canvasZoomRef.current = canvasZoom;
  const [autoConfigBusy, setAutoConfigBusy] = useState(false);
  const [autoConfigPreview, setAutoConfigPreview] = useState<WorkspaceAutoConfigPreviewResult | null>(null);
  const resetExecutionStateRef = useRef<() => void>(() => {});

  const {
    templates: agents,
    query,
    setQuery,
    sourceFilter,
    setSourceFilter,
    divisionFilter,
    setDivisionFilter,
    importValue,
    setImportValue,
    importSummary,
    importing,
    error: libraryError,
    clearError: clearLibraryError,
    sources,
    divisions,
    groupedTemplates: groupedAgents,
    loadTemplates,
    loadBundledAgencyCatalog,
    syncDefaultAgencyRepo,
    importAgencySource,
  } = useTemplatesLibrary({ autoLoad: false });

  const handleWorkspaceContextReset = useCallback(() => {
    resetExecutionStateRef.current();
    setAutoConfigPreview(null);
    setActiveTab('canvas');
  }, []);

  const {
    workspaces,
    activeWorkspaceId,
    selectedNodeId,
    loading,
    saving,
    error,
    setError,
    activeWorkspace,
    activeWorkspaceDirty,
    selectedNode,
    setSelectedNodeId,
    load,
    selectWorkspace,
    createWorkspace,
    saveWorkspace,
    saveWorkspaceDraft,
    discardActiveWorkspaceChanges,
    deleteWorkspace,
    patchActiveWorkspace,
    patchSelectedNode,
    removeNode,
    addEdge,
    removeEdge,
    handleDragEnd: handleWorkspaceDragEnd,
  } = useWorkspaceCrud({
    loadTemplates,
    clearLibraryError,
    onWorkspaceContextReset: handleWorkspaceContextReset,
  });

  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const {
    generatedPrompt,
    executionResult,
    generating,
    executing,
    copied,
    resetExecutionState,
    generatePrompt,
    copyPrompt,
    sendPromptToChat,
    executeWorkspace,
    openExecutionSessionInChat,
  } = useWorkspaceExecution({
    activeWorkspace,
    saveWorkspace,
    clearLibraryError,
    onError: message => setError(message),
    canNavigateToChat: () => confirmUnsavedChanges('open Chat'),
    onNavigateToChat: sessionId => {
      if (onOpenSessionInChat) {
        onOpenSessionInChat(sessionId ?? null);
        return;
      }
      navigate('/chat');
    },
    onAfterExecute: () => setActiveTab('runs'),
  });

  useEffect(() => {
    resetExecutionStateRef.current = resetExecutionState;
  }, [resetExecutionState]);

  const agentsById = useMemo(
    () => new Map(agents.map(agent => [agent.id, agent] as const)),
    [agents],
  );

  // Zoom-aware DnD modifier
  const zoomModifier: Modifier = useMemo(() => {
    return ({ transform }) => ({
      ...transform,
      x: transform.x / canvasZoomRef.current,
      y: transform.y / canvasZoomRef.current,
    });
  }, []);

  const workspaceMetrics = useMemo(() => {
    const totalNodes = workspaces.reduce((sum, w) => sum + w.nodes.length, 0);
    const modeCounts: Record<string, number> = {};
    for (const w of workspaces) {
      modeCounts[w.defaultMode] = (modeCounts[w.defaultMode] || 0) + 1;
    }
    const topMode = Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0];
    return { totalNodes, modeCounts, topMode: topMode?.[0] || null };
  }, [workspaces]);
  const displayError = error || libraryError;
  const unsavedMessage = activeWorkspace
    ? `Workspace "${activeWorkspace.name}" has unsaved local changes. Save before continuing if you want to keep them.`
    : 'This workspace has unsaved local changes. Save before continuing if you want to keep them.';

  const confirmUnsavedChanges = useCallback(async (action: string, options: { danger?: boolean } = {}) => {
    if (!activeWorkspaceDirty) return true;
    return confirm({
      title: 'Unsaved changes',
      message: `${unsavedMessage}\n\nContinue to ${action}?`,
      confirmLabel: 'Continue',
      cancelLabel: 'Stay here',
      danger: options.danger,
    });
  }, [activeWorkspaceDirty, confirm, unsavedMessage]);

  const openWorkspaceRunInChat = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    const canOpen = await confirmUnsavedChanges('open Chat');
    if (!canOpen) return;
    if (onOpenSessionInChat) {
      onOpenSessionInChat(sessionId);
      return;
    }
    navigate('/chat');
  }, [confirmUnsavedChanges, navigate, onOpenSessionInChat]);

  useEffect(() => {
    return registerGuard(() => confirmUnsavedChanges('leave this page'));
  }, [confirmUnsavedChanges, registerGuard]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!activeWorkspaceDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [activeWorkspaceDirty]);

  const clearAutoConfigPreview = useCallback(() => {
    setAutoConfigPreview(null);
  }, []);

  const autoConfigPlan = useMemo(
    () => (activeWorkspace && autoConfigPreview
      ? buildWorkspaceAutoConfigPlan(activeWorkspace, autoConfigPreview, agentsById)
      : null),
    [activeWorkspace, agentsById, autoConfigPreview],
  );

  const generateAutoConfig = useCallback(async () => {
    if (!activeWorkspace) return;
    clearAutoConfigPreview();
    setAutoConfigBusy(true);
    setError('');
    clearLibraryError();
    try {
      const saved = await saveWorkspace();
      if (!saved) return;
      const pipelineBrief = String(saved.pipelineBrief || '').trim();
      if (!pipelineBrief) {
        setError('Pipeline brief is required before auto-configuration.');
        return;
      }
      const response = await api.agentStudio.autoConfigWorkspace(saved.id, { pipelineBrief });
      setAutoConfigPreview(response.data);
    } catch (previewError) {
      clearAutoConfigPreview();
      if (typeof previewError === 'object' && previewError && 'response' in previewError) {
        const response = (previewError as { response?: { data?: { error?: string; details?: string } } }).response;
        setError(response?.data?.error || response?.data?.details || 'Could not auto-configure workspace.');
      } else if (previewError instanceof Error) {
        setError(previewError.message);
      } else {
        setError('Could not auto-configure workspace.');
      }
    } finally {
      setAutoConfigBusy(false);
    }
  }, [activeWorkspace, clearAutoConfigPreview, clearLibraryError, saveWorkspace, setError]);

  const applyAutoConfig = useCallback(async (saveAfterApply = false) => {
    if (!autoConfigPlan?.hasChanges) return;

    if (saveAfterApply) {
      const saved = await saveWorkspaceDraft(autoConfigPlan.nextWorkspace);
      if (saved) clearAutoConfigPreview();
      return;
    }

    patchActiveWorkspace(autoConfigPlan.patch);
    clearAutoConfigPreview();
  }, [autoConfigPlan, clearAutoConfigPreview, patchActiveWorkspace, saveWorkspaceDraft]);

  const patchWorkspaceAndInvalidatePreview = useCallback((patch: Partial<AgentWorkspace>) => {
    clearAutoConfigPreview();
    patchActiveWorkspace(patch);
  }, [clearAutoConfigPreview, patchActiveWorkspace]);

  const patchNodeAndInvalidatePreview = useCallback((patch: Partial<AgentWorkspace['nodes'][number]>) => {
    clearAutoConfigPreview();
    patchSelectedNode(patch);
  }, [clearAutoConfigPreview, patchSelectedNode]);

  const removeNodeAndInvalidatePreview = useCallback((nodeId: string) => {
    clearAutoConfigPreview();
    removeNode(nodeId);
  }, [clearAutoConfigPreview, removeNode]);

  const addEdgeAndInvalidatePreview = useCallback((fromNodeId: string, toNodeId: string, kind?: AgentWorkspace['edges'][number]['kind']) => {
    clearAutoConfigPreview();
    addEdge(fromNodeId, toNodeId, kind);
  }, [addEdge, clearAutoConfigPreview]);

  const removeEdgeAndInvalidatePreview = useCallback((edgeId: string) => {
    clearAutoConfigPreview();
    removeEdge(edgeId);
  }, [clearAutoConfigPreview, removeEdge]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const dragData = event.active.data.current as { type?: string } | undefined;
    const mayChangeWorkspace = dragData?.type === 'workspace-node'
      || (dragData?.type === 'library-agent' && event.over?.id === 'workspace-canvas');
    if (mayChangeWorkspace) clearAutoConfigPreview();
    handleWorkspaceDragEnd(event, agentsById, canvasRef, canvasZoomRef.current);
  }, [agentsById, clearAutoConfigPreview, handleWorkspaceDragEnd]);

  const selectWorkspaceSafely = useCallback(async (id: string) => {
    if (id === activeWorkspaceId) return;
    const canSwitch = await confirmUnsavedChanges('switch workspaces');
    if (!canSwitch) return;
    discardActiveWorkspaceChanges();
    selectWorkspace(id);
  }, [activeWorkspaceId, confirmUnsavedChanges, discardActiveWorkspaceChanges, selectWorkspace]);

  const createWorkspaceSafely = useCallback(async () => {
    const canCreate = await confirmUnsavedChanges('create a new workspace');
    if (!canCreate) return;
    discardActiveWorkspaceChanges();
    await createWorkspace();
  }, [confirmUnsavedChanges, createWorkspace, discardActiveWorkspaceChanges]);

  const createFromTeam = useCallback(async (team: TeamDefinition) => {
    const canCreate = await confirmUnsavedChanges('create a workspace from a team');
    if (!canCreate) return;

    const confirmedCreate = await confirm({
      title: 'Create team workspace',
      message: `Create "${team.name}" as a saved workspace?\n\nThis is useful for testing, and you can delete it afterwards from Quick Start or Advanced mode.`,
      confirmLabel: 'Create workspace',
      cancelLabel: 'Cancel',
    });
    if (!confirmedCreate) return;

    discardActiveWorkspaceChanges();

    setCreatingFromTeam(true);
    setError('');
    clearLibraryError();

    try {
      // Load templates if not already loaded
      const result = await loadTemplates();
      if (!result.ok) {
        setError(result.error || 'Could not load agent templates.');
        return;
      }

      // Resolve the team: match agents by name
      const resolved = resolveTeam(team, result.ok ? result.templates : []);

      if (resolved.missingAgents.length > 0) {
        setError(
          `Certains agents sont introuvables : ${resolved.missingAgents.join(', ')}. ` +
          'Utilise "Load bundled" ou "Import default agency" dans la bibliothèque de templates.',
        );
        return;
      }

      if (resolved.ambiguousAgents.length > 0) {
        const ambiguityDetails = resolved.ambiguousAgents
          .map(entry => {
            const candidates = entry.matches
              .map(match => {
                const parts = [
                  match.name,
                  match.source || 'template',
                  match.sourcePath || match.slug || match.id,
                ].filter(Boolean);
                return parts.join(' · ');
              })
              .join(' | ');
            return `${entry.agentName}: ${candidates}`;
          })
          .join('; ');

        setError(
          `Certains agents sont ambigus : ${ambiguityDetails}. ` +
          'Renomme, désambiguïse ou supprime les doublons de templates avant de créer cette équipe.',
        );
        return;
      }

      // Build the workspace payload
      const draft: Partial<AgentWorkspace> = {
        name: resolved.name,
        description: resolved.description,
        pipelineBrief: resolved.pipelineBrief,
        sharedContext: resolved.sharedContext,
        commonRules: resolved.commonRules,
        defaultMode: resolved.defaultMode,
        nodes: resolved.nodes.map((n) => ({
          id: n.id,
          agentId: n.agentId,
          role: n.role,
          label: n.label,
          modelOverride: n.modelOverride || '',
          skills: n.skills || [],
          toolsets: n.toolsets || [],
          position: n.position,
        })),
        edges: resolved.edges.map((e) => ({
          id: `edge_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
          fromNodeId: e.fromNodeId,
          toNodeId: e.toNodeId,
          kind: e.kind,
        })),
      };

      const newWorkspace = await createWorkspace(draft);
      if (!newWorkspace) return;

      // Create through the workspace hook so local state and the advanced canvas stay in sync.
      setWorkspaceMode('advanced');
      setActiveTab('canvas');
      setViewMode('canvas');
      setSelectedEdgeId(null);
    } catch (createError) {
      if (typeof createError === 'object' && createError && 'response' in createError) {
        const response = (createError as { response?: { data?: { error?: string; details?: string } } }).response;
        setError(response?.data?.error || response?.data?.details || 'Could not create workspace from team.');
      } else if (createError instanceof Error) {
        setError(createError.message);
      } else {
        setError('Could not create workspace from team.');
      }
    } finally {
      setCreatingFromTeam(false);
    }
  }, [confirm, confirmUnsavedChanges, createWorkspace, discardActiveWorkspaceChanges, loadTemplates, clearLibraryError, setError]);

  const deleteWorkspaceSafely = useCallback(async () => {
    if (!activeWorkspace) return;
    const confirmed = await confirm({
      title: 'Delete workspace',
      message: activeWorkspaceDirty
        ? `${unsavedMessage}\n\nDelete "${activeWorkspace.name}" anyway? This removes the saved workspace and discards the local draft.`
        : `Delete "${activeWorkspace.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!confirmed) return;
    await deleteWorkspace();
  }, [activeWorkspace, activeWorkspaceDirty, confirm, deleteWorkspace, unsavedMessage]);

  const openInterfaceSafely = useCallback(async () => {
    const canOpen = await confirmUnsavedChanges('open the task runner');
    if (!canOpen) return;
    setActiveTab('interface');
  }, [confirmUnsavedChanges]);

  const changeTabSafely = useCallback(async (tab: WorkspaceTab) => {
    if (tab === activeTab) return;
    if (tab === 'interface') {
      const canOpen = await confirmUnsavedChanges('open the task runner');
      if (!canOpen) return;
    }
    setActiveTab(tab);
  }, [activeTab, confirmUnsavedChanges]);

  const openQuickWorkspaceEditor = useCallback(() => {
    setWorkspaceMode('advanced');
    setActiveTab('canvas');
    setViewMode('canvas');
  }, []);

  const openQuickStart = useCallback(async () => {
    const canOpen = await confirmUnsavedChanges('return to Quick Start');
    if (!canOpen) return;
    setWorkspaceMode('quick');
  }, [confirmUnsavedChanges]);

  const openQuickWorkspaceInterface = useCallback(async () => {
    const canOpen = await confirmUnsavedChanges('open the task runner');
    if (!canOpen) return;
    setWorkspaceMode('advanced');
    setActiveTab('interface');
  }, [confirmUnsavedChanges]);

  const templatePanelProps = {
    title: 'Templates',
    templates: agents,
    groupedTemplates: groupedAgents,
    query,
    sourceFilter,
    divisionFilter,
    sources,
    divisions,
    importValue,
    importSummary,
    importing,
    onQueryChange: setQuery,
    onSourceFilterChange: setSourceFilter,
    onDivisionFilterChange: setDivisionFilter,
    onImportValueChange: setImportValue,
    onImportBundled: () => {
      void loadBundledAgencyCatalog();
    },
    onImportDefault: () => {
      void syncDefaultAgencyRepo();
    },
    onImportSource: () => {
      void importAgencySource();
    },
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const heroSection = (
    <section className="relative overflow-hidden rounded-2xl border border-primary/10 bg-gradient-to-br from-card via-card to-secondary/30 p-5">
      <div className="absolute right-[-60px] top-[-40px] h-48 w-48 rounded-full bg-primary/8 blur-3xl" />
      <div className="relative">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70 font-medium">
              Studio
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              Workspaces
            </h1>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground leading-relaxed">
              {workspaceMode === 'quick'
                ? 'Pre-built agent teams. Pick one and start.'
                : 'Multi-agent compositions built from templates.'
              }
              {activeWorkspace && workspaceMode === 'advanced' && (
                <span className="ml-2 text-primary">
                  Editing <span className="font-medium">{activeWorkspace.name}</span>
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {activeWorkspace?.updatedAt && workspaceMode === 'advanced' && (
              <div className="flex-shrink-0 text-right hidden sm:block">
                <p className="text-[10px] text-muted-foreground/60">last saved</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {new Date(activeWorkspace.updatedAt).toLocaleString()}
                </p>
              </div>
            )}
            {/* Toggle Quick / Advanced */}
            <button
              onClick={() => setWorkspaceMode(current => current === 'quick' ? 'advanced' : 'quick')}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all',
                workspaceMode === 'quick'
                  ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'border-border text-foreground hover:bg-muted',
              )}
            >
              <ArrowLeftRight size={14} />
              {workspaceMode === 'quick' ? 'Advanced' : 'Quick Start'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );

  if (workspaceMode === 'quick') {
    return (
      <div className="space-y-4">
        {heroSection}
        {activeWorkspace && (
          <section className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                  Active test workspace
                </p>
                <h2 className="mt-1 truncate text-base font-semibold text-foreground">
                  {activeWorkspace.name}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  This team has already been saved as a workspace. Open it to inspect the canvas, or delete it when the test is done.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={openQuickWorkspaceEditor}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                >
                  <Pencil size={15} />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void openQuickWorkspaceInterface();
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                >
                  <MessageSquare size={15} />
                  Open task runner
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void deleteWorkspaceSafely();
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
                >
                  <Trash2 size={15} />
                  Delete test
                </button>
              </div>
            </div>
          </section>
        )}
        {displayError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {displayError}
          </div>
        )}
        {creatingFromTeam ? (
          <div className="flex min-h-[320px] items-center justify-center">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <TeamGallery
            agents={agents}
            loading={importing}
            onSelectTeam={createFromTeam}
            onLoadBundled={() => {
              void loadBundledAgencyCatalog();
            }}
          />
        )}
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className="space-y-4">
        {heroSection}
        <WorkspaceEmptyState
          onCreateWorkspace={() => { void createWorkspaceSafely(); }}
          onImportBundled={() => { void loadBundledAgencyCatalog(); }}
        />
      </div>
    );
  }

  return (
    <DndContext onDragEnd={handleDragEnd} modifiers={[restrictToWindowEdges, zoomModifier]}>
      <div className="space-y-4">
        {/* ── Header: hero + metrics ── */}
        {heroSection}

        {/* ── Metrics row ── */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric
            icon={<FolderKanban size={14} />}
            label="Workspaces"
            value={String(workspaces.length)}
          />
          <Metric
            icon={<Layers size={14} />}
            label="Total nodes"
            value={String(workspaceMetrics.totalNodes)}
          />
          <Metric
            icon={<Play size={14} />}
            label="Default mode"
            value={workspaceMetrics.topMode || '—'}
          />
          <Metric
            icon={<Clock3 size={14} />}
            label="Active nodes"
            value={String(activeWorkspace?.nodes.length || 0)}
          />
        </section>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Agent Studio templates and workspaces are shared globally across profiles. Only runtime sessions/state remain profile-specific.
        </div>

        <WorkspaceListPanel
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          saving={saving}
          generating={generating}
          hasActiveWorkspace={Boolean(activeWorkspace)}
          hasUnsavedChanges={activeWorkspaceDirty}
          onSelectWorkspace={(id) => {
            void selectWorkspaceSafely(id);
          }}
          onOpenQuickStart={() => {
            void openQuickStart();
          }}
          onCreateWorkspace={() => {
            void createWorkspaceSafely();
          }}
          onSaveWorkspace={() => {
            void saveWorkspace();
          }}
          onGeneratePrompt={() => {
            void generatePrompt();
          }}
          onOpenInterface={() => {
            void openInterfaceSafely();
          }}
          onDeleteWorkspace={() => {
            void deleteWorkspaceSafely();
          }}
        />

        {displayError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {displayError}
          </div>
        )}

        <WorkspaceTabs
          activeTab={activeTab}
          onChange={(tab) => {
            void changeTabSafely(tab);
          }}

          nodeCount={activeWorkspace?.nodes.length || 0}
          executionResult={executionResult}
        />

        {activeTab === 'canvas' && (
          <>
            {/* View mode toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/20 p-0.5 w-fit">
              <button
                onClick={() => setViewMode('canvas')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  viewMode === 'canvas'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Canvas
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  viewMode === 'table'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Table
              </button>
            </div>

            {viewMode === 'canvas' ? (
              <div className="grid min-h-[680px] grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
                <WorkspaceTemplatePanel {...templatePanelProps} />
                <WorkspaceEditorPanel
                  canvasRef={canvasRef}
                  canvasZoom={canvasZoom}
                  onCanvasZoomChange={setCanvasZoom}
                  workspace={activeWorkspace}
                  agentsById={agentsById}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
                  selectedNode={selectedNode}
                  generatedPrompt={generatedPrompt}
                  onSelectEdge={setSelectedEdgeId}
                  copied={copied}
                  onSelectNode={(id) => { setSelectedNodeId(id); setSelectedEdgeId(null); }}
                  onRemoveNode={removeNodeAndInvalidatePreview}
                  onAddEdge={addEdgeAndInvalidatePreview}
                  onRemoveEdge={removeEdgeAndInvalidatePreview}
                  onPatchWorkspace={patchWorkspaceAndInvalidatePreview}
                  onPatchNode={patchNodeAndInvalidatePreview}
                  onCopyPrompt={() => {
                    void copyPrompt();
                  }}
                  onSendToChat={() => {
                    void sendPromptToChat();
                  }}
                  autoConfigBusy={autoConfigBusy}
                  autoConfigPreview={autoConfigPreview}
                  autoConfigPlan={autoConfigPlan}
                  autoConfigSaving={saving}
                  onGenerateAutoConfig={() => {
                    void generateAutoConfig();
                  }}
                  onApplyAutoConfig={() => {
                    void applyAutoConfig(false);
                  }}
                  onApplyAndSaveAutoConfig={() => {
                    void applyAutoConfig(true);
                  }}
                  onDiscardAutoConfig={clearAutoConfigPreview}
                />
              </div>
            ) : (
              activeWorkspace && (
                <WorkspaceNodeTable
                  workspace={activeWorkspace}
                  agentsById={agentsById}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={(id) => {
                    setSelectedNodeId(id);
                    setViewMode('canvas');
                  }}
                />
              )
            )}
          </>
        )}

        {activeTab === 'interface' && (
          <WorkspaceInterfacePanel
            workspace={activeWorkspace}
            agentsById={agentsById}
            saveWorkspace={saveWorkspace}
            onError={message => setError(message)}
            onOpenSessionInChat={sessionId => {
              void openWorkspaceRunInChat(sessionId);
            }}
          />
        )}

        {activeTab === 'runs' && (
          <WorkspaceRunPanel
            workspace={activeWorkspace}
            generatedPrompt={generatedPrompt}
            copied={copied}
            generating={generating}
            executing={executing}
            executionResult={executionResult}
            onGeneratePrompt={() => {
              void generatePrompt();
            }}
            onCopyPrompt={() => {
              void copyPrompt();
            }}
            onSendToChat={() => {
              void sendPromptToChat();
            }}
            onExecuteWorkspace={() => {
              void executeWorkspace();
            }}
            onOpenPersistedRun={() => {
              void openExecutionSessionInChat();
            }}
          />
        )}
      </div>
    </DndContext>
  );
}

// ── Metric card ──────────────────────────────────────────────────

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-muted-foreground/60 mb-2">
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className="text-xl font-semibold text-foreground tabular-nums">
        {value}
      </p>
    </div>
  );
}

// ── WorkspaceTabs ────────────────────────────────────────────────

function WorkspaceTabs({
  activeTab,
  onChange,
  nodeCount,
  executionResult,
}: {
  activeTab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  nodeCount: number;
  executionResult: AgentWorkspaceExecutionResult | null;
}) {
  const executionCount = executionResult?.runs?.length
    || (executionResult?.session_id || executionResult?.output ? 1 : 0);
  const tabs: Array<{ id: WorkspaceTab; label: string; description: string; count?: string }> = [
    { id: 'canvas', label: 'Canvas', description: 'Compose & edit', count: String(nodeCount) },
    { id: 'interface', label: 'Task Runner', description: 'Run tasks and open the persisted chat session', count: String(nodeCount) },
    { id: 'runs', label: 'Execution', description: 'Prompts, outputs and persisted run history', count: String(executionCount) },
  ];

  return (
    <div className="flex flex-wrap gap-2 border-b border-border">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'group -mb-px flex items-center gap-3 border-b-2 px-4 py-3 text-left transition-colors',
            activeTab === tab.id
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <span>
            <span className="block text-sm font-medium">{tab.label}</span>
            <span className="block text-[11px] text-muted-foreground">{tab.description}</span>
          </span>
          {tab.count && (
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold',
              activeTab === tab.id ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
            )}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
