import type { ChatToolCall } from '../../types';

export function normalizeToolCalls(input: unknown): ChatToolCall[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const calls = input
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      ...item,
      id: typeof item.id === 'string' ? item.id : undefined,
      type: typeof item.type === 'string' ? item.type : undefined,
      name: typeof item.name === 'string' ? item.name : undefined,
      arguments: typeof item.arguments === 'string' ? item.arguments : undefined,
      function: item.function && typeof item.function === 'object'
        ? {
            name: typeof (item.function as { name?: unknown }).name === 'string'
              ? String((item.function as { name?: unknown }).name)
              : undefined,
            arguments: typeof (item.function as { arguments?: unknown }).arguments === 'string'
              ? String((item.function as { arguments?: unknown }).arguments)
              : undefined,
          }
        : undefined,
    } satisfies ChatToolCall));

  return calls.length > 0 ? calls : undefined;
}

export function normalizeToolProgress(input: unknown): ChatToolCall[] | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const progress = input as Record<string, unknown>;
  const toolName = firstNonEmptyString(
    progress.tool,
    progress.tool_name,
    progress.toolName,
    progress.name,
    progress.function_name,
    (progress.function as { name?: unknown } | undefined)?.name,
  );
  if (!toolName) return undefined;

  const toolCallId = firstNonEmptyString(
    progress.toolCallId,
    progress.tool_call_id,
    progress.callId,
    progress.call_id,
    progress.id,
  );
  const argumentPreview = stringifyToolProgressValue(
    progress.arguments
    ?? progress.args
    ?? progress.input
    ?? progress.label
    ?? progress.arguments_preview
    ?? progress.argument_preview
    ?? progress.params,
  );

  return [{
    id: toolCallId || `progress:${toolName}`,
    type: 'function',
    function: {
      name: toolName,
      arguments: argumentPreview,
    },
    status: firstNonEmptyString(progress.status, progress.phase, progress.state) || undefined,
    label: firstNonEmptyString(progress.label) || undefined,
    emoji: firstNonEmptyString(progress.emoji) || undefined,
  }];
}

export function mergeToolCallDeltas(current: ChatToolCall[], deltas: unknown): ChatToolCall[] {
  const normalizedDeltas = normalizeToolCalls(deltas);
  if (!normalizedDeltas?.length) return current;

  const next = [...current];
  normalizedDeltas.forEach((delta) => {
    const targetIndex = resolveDeltaTargetIndex(next, delta);
    const existing = next[targetIndex] || {};
    const existingFunction = existing.function || {};
    const deltaFunction = delta.function || {};
    next[targetIndex] = {
      ...existing,
      ...delta,
      id: delta.id || existing.id,
      type: delta.type || existing.type,
      name: delta.name || existing.name,
      arguments: mergeDeltaText(existing.arguments, delta.arguments),
      function: {
        name: mergeDeltaText(existingFunction.name, deltaFunction.name),
        arguments: mergeDeltaText(existingFunction.arguments, deltaFunction.arguments),
      },
    };
  });

  return next;
}

function resolveDeltaTargetIndex(existingCalls: ChatToolCall[], delta: ChatToolCall): number {
  if (delta.id) {
    const byId = existingCalls.findIndex(call => call.id === delta.id);
    if (byId >= 0) return byId;
  }

  const deltaIndex = readToolCallIndex(delta);
  if (deltaIndex != null) {
    const existingAtIndex = existingCalls[deltaIndex];
    if (!existingAtIndex) return deltaIndex;

    if (delta.id && existingAtIndex.id && delta.id !== existingAtIndex.id) {
      return existingCalls.length;
    }

    const deltaName = delta.function?.name || delta.name;
    const existingName = existingAtIndex.function?.name || existingAtIndex.name;
    if (deltaName && existingName && deltaName !== existingName) {
      return existingCalls.length;
    }

    return deltaIndex;
  }

  return existingCalls.length;
}

function readToolCallIndex(toolCall: ChatToolCall): number | null {
  const value = (toolCall as { index?: unknown }).index;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  return null;
}

function mergeDeltaText(existing: string | undefined, incoming: string | undefined): string | undefined {
  if (!incoming) return existing || undefined;
  if (!existing) return incoming;
  if (incoming === existing) return existing;
  if (incoming.startsWith(existing)) return incoming;
  if (existing.endsWith(incoming)) return existing;
  return `${existing}${incoming}`;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function stringifyToolProgressValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (value == null) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
