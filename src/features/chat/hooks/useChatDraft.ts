import { useEffect } from 'react';
import { consumeDraft } from '../chatDraftBridge';
import type { StoredChatDraft } from '../chatDraftBridge';

interface UseChatDraftOptions {
  setInput: (value: string) => void;
  onDraft?: (draft: StoredChatDraft) => Promise<void> | void;
}

export function useChatDraft({ setInput, onDraft }: UseChatDraftOptions) {
  useEffect(() => {
    const delegatedDraft = consumeDraft();
    if (delegatedDraft?.text) {
      void (async () => {
        await onDraft?.(delegatedDraft);
        setInput(delegatedDraft.text);
      })();
    }
  }, [onDraft, setInput]);
}
