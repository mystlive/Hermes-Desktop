import { useEffect } from 'react';
import { consumeDraft } from '../chatDraftBridge';
import type { StoredChatDraft } from '../chatDraftBridge';

interface UseChatDraftOptions {
  setInput: (value: string) => void;
  onDraft?: (draft: StoredChatDraft) => Promise<void> | void;
}

export function useChatDraft({ setInput, onDraft }: UseChatDraftOptions) {
  useEffect(() => {
    let cancelled = false;
    const delegatedDraft = consumeDraft();
    if (delegatedDraft?.text) {
      void (async () => {
        await onDraft?.(delegatedDraft);
        if (!cancelled) {
          setInput(delegatedDraft.text);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [onDraft, setInput]);
}
