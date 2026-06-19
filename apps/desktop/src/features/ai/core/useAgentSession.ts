import { PermissionBehavior } from "@protocol";
import type { AgentMessage, PermissionPrompt } from "@protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  agentInterrupt,
  agentRespondPermission,
  agentSend,
  aiConversationContextSet,
  aiConversationCreate,
  aiConversationGet,
  aiConversationTitleGenerate,
  aiConversationTitleUpdate,
  onAgentMessage,
  onAgentPermissionRequest,
} from "@/features/ai/core/agent-client";
import type {
  AiContextAttachment,
  AiContextAttachmentInput,
  AiConversation,
  TranscriptEntry,
} from "@/features/ai/core/ai-types";
import { takeAgentEditNotesSinceLastSend } from "@/features/editor/core/proposed-changes-store";
import type { AiProviderCommandError } from "@/features/settings";
import { parseAiProviderCommandError } from "@/features/settings/settings-service";

export type { AiBlock, TranscriptEntry } from "@/features/ai/core/ai-types";

const DEFAULT_AI_TITLE = "AI";
const AUTO_TITLE_USER_MESSAGE_LIMIT = 2;

type UseAiConversationOptions = {
  agentId?: string;
  conversationId?: string | null;
  initialContextAttachments?: AiContextAttachmentInput[];
  initialTitle?: string;
  onConversationReady?: (conversation: AiConversation) => void;
  onConversationUpdated?: (conversation: AiConversation) => void;
};

export function useAiConversation({
  agentId = "workspace-ai",
  conversationId,
  initialContextAttachments = [],
  initialTitle = DEFAULT_AI_TITLE,
  onConversationReady,
  onConversationUpdated,
}: UseAiConversationOptions = {}) {
  const initialContextRef = useRef(initialContextAttachments);
  const activeConversationIdRef = useRef<string | null>(null);
  const [conversation, setConversation] = useState<AiConversation | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<PermissionPrompt | null>(null);
  const [agentError, setAgentError] = useState<AiProviderCommandError | null>(
    null,
  );

  const pendingRef = useRef<AgentMessage[]>([]);
  const frameRef = useRef<number | null>(null);
  const titleRequestSequenceRef = useRef(0);

  const applyConversation = useCallback(
    (next: AiConversation) => {
      activeConversationIdRef.current = next.id;
      setConversation(next);
      setEntries(
        next.transcriptEntries.map((entry) =>
          normalizeTranscriptEntry(entry.payload, entry.id),
        ),
      );
      onConversationReady?.(next);
    },
    [onConversationReady],
  );

  const refreshConversationMetadata = useCallback(
    async (conversationId: string) => {
      const next = await aiConversationGet(conversationId).catch(() => null);

      if (!next || activeConversationIdRef.current !== conversationId) {
        return;
      }

      setConversation(next);
      onConversationUpdated?.(next);
    },
    [onConversationUpdated],
  );

  const flush = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const batch = pendingRef.current;
    if (batch.length === 0) {
      return;
    }
    pendingRef.current = [];
    const terminal = batch.some(
      (message) => message.kind === "done" || message.kind === "error",
    );
    setEntries((current) => batch.reduce(reduceMessage, current));
    if (terminal) {
      setBusy(false);
      setPermission(null);
      const conversationId = activeConversationIdRef.current;
      if (conversationId) {
        void refreshConversationMetadata(conversationId);
      }
    }
  }, [refreshConversationMetadata]);

  const ingest = useCallback(
    (message: AgentMessage) => {
      if (message.kind === "error") {
        setAgentError(
          parseAiProviderCommandError({
            code: message.data.code,
            message: message.data.message,
          }),
        );
      }
      pendingRef.current.push(message);
      if (message.kind === "done" || message.kind === "error") {
        flush();
      } else if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(flush);
      }
    },
    [flush],
  );

  useEffect(() => {
    let cancelled = false;

    if (conversationId && conversationId === activeConversationIdRef.current) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setBusy(false);
    setPermission(null);
    setAgentError(null);
    pendingRef.current = [];

    const load = async () => {
      if (!conversationId) {
        setConversation(null);
        setEntries([]);
        activeConversationIdRef.current = null;
        setLoading(false);
        return;
      }

      const next = await aiConversationGet(conversationId);

      if (cancelled) {
        return;
      }
      if (!next) {
        setConversation(null);
        setEntries([]);
        activeConversationIdRef.current = null;
      } else {
        applyConversation(next);
      }
      setLoading(false);
    };

    void load().catch((error) => {
      if (cancelled) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setEntries([
        {
          role: "assistant",
          id: "load-error",
          blocks: [{ type: "text", text: message }],
          done: true,
        },
      ]);
      setConversation(null);
      activeConversationIdRef.current = null;
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [applyConversation, conversationId]);

  useEffect(() => {
    const subscriptions = Promise.all([
      onAgentMessage((notification) => {
        if (notification.conversationId === activeConversationIdRef.current) {
          ingest(notification.message);
        }
      }),
      onAgentPermissionRequest((prompt) => {
        if (prompt.conversationId === activeConversationIdRef.current) {
          setPermission(prompt);
        }
      }),
    ]);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      void subscriptions.then((unsubscribers) =>
        unsubscribers.forEach((unsubscribe) => unsubscribe()),
      );
    };
  }, [ingest]);

  const setContextAttachments = useCallback(
    async (contextAttachments: AiContextAttachmentInput[]) => {
      if (!conversation) {
        return null;
      }
      const next = await aiConversationContextSet(
        conversation.id,
        contextAttachments,
      );
      if (next) {
        setConversation(next);
        onConversationUpdated?.(next);
      }
      return next;
    },
    [conversation, onConversationUpdated],
  );

  const send = useCallback(
    (prompt: string, contextOverride?: AiContextAttachmentInput[]) => {
      const text = prompt.trim();
      if (!text || busy) {
        return;
      }

      const startTurn = async () => {
        setBusy(true);
        setPermission(null);
        setAgentError(null);

        try {
          const contextAttachments =
            contextOverride ??
            conversation?.contextAttachments.map(toContextInput) ??
            initialContextRef.current;
          const previousUserPrompts = userPromptsFromEntries(entries);
          const nextUserPrompts = [...previousUserPrompts, text];
          const activeConversation =
            conversation ??
            (await aiConversationCreate({
              agentId,
              contextAttachments,
              title: initialTitle,
            }));

          if (!conversation) {
            activeConversationIdRef.current = activeConversation.id;
            setConversation(activeConversation);
            onConversationReady?.(activeConversation);
          }

          setEntries((current) => [
            ...current,
            {
              role: "user",
              id: `user-${activeConversation.id}-${current.length}`,
              text,
              contextAttachments,
            },
            {
              role: "assistant",
              id: `ai-${activeConversation.id}-${current.length + 1}`,
              blocks: [],
              done: false,
            },
          ]);

          if (
            initialTitle === DEFAULT_AI_TITLE &&
            nextUserPrompts.length <= AUTO_TITLE_USER_MESSAGE_LIMIT
          ) {
            const titleRequestSequence = ++titleRequestSequenceRef.current;
            void aiConversationTitleGenerate(nextUserPrompts)
              .then((generatedTitle) => {
                const title = generatedTitle.trim();

                if (
                  !title ||
                  activeConversationIdRef.current !== activeConversation.id ||
                  titleRequestSequence !== titleRequestSequenceRef.current
                ) {
                  return null;
                }

                return aiConversationTitleUpdate(activeConversation.id, title);
              })
              .then((next) => {
                if (
                  next &&
                  activeConversationIdRef.current === next.id &&
                  titleRequestSequence === titleRequestSequenceRef.current
                ) {
                  setConversation(next);
                  onConversationUpdated?.(next);
                }
              })
              .catch(() => {});
          }

          if (contextOverride && conversation) {
            void aiConversationContextSet(conversation.id, contextOverride)
              .then((next) => {
                if (next) {
                  setConversation(next);
                  onConversationUpdated?.(next);
                }
              })
              .catch(() => {});
          }

          // Fold in any notes about the agent's prior edits (a rejection, or a
          // snippet that couldn't be located) so the model knows the outcome
          // and doesn't blindly repeat them.
          const editNotes = takeAgentEditNotesSinceLastSend();
          const promptWithNotes =
            editNotes.length > 0 ? `${editNotes.join("\n")}\n\n${text}` : text;

          await agentSend({
            conversationId: activeConversation.id,
            agentId: activeConversation.agentId || agentId,
            prompt: promptWithNotes,
            contextAttachments,
          });
          void refreshConversationMetadata(activeConversation.id);
        } catch (error) {
          const providerError = parseAiProviderCommandError(error);
          setAgentError(providerError);
          ingest({
            kind: "error",
            data: { code: providerError.code, message: providerError.message },
          });
          ingest({ kind: "done" });
        }
      };

      void startTurn();
    },
    [
      agentId,
      busy,
      conversation,
      entries,
      ingest,
      initialTitle,
      onConversationReady,
      onConversationUpdated,
      refreshConversationMetadata,
    ],
  );

  const interrupt = useCallback(() => {
    if (conversation) {
      void agentInterrupt(conversation.id);
    }
  }, [conversation]);

  const respondPermission = useCallback((behavior: PermissionBehavior) => {
    setPermission((current) => {
      if (current) {
        void agentRespondPermission(current.requestId, behavior);
      }
      return null;
    });
  }, []);

  return {
    busy,
    conversation,
    entries,
    agentError,
    interrupt,
    loading,
    permission,
    respondPermission,
    send,
    setContextAttachments,
  };
}

function reduceMessage(
  entries: TranscriptEntry[],
  message: AgentMessage,
): TranscriptEntry[] {
  if (message.kind === "init") {
    return entries;
  }
  if (message.kind === "done") {
    return updateLastAi(entries, (entry) => ({ ...entry, done: true }));
  }

  return updateLastAi(entries, (entry) => {
    const blocks = [...entry.blocks];
    switch (message.kind) {
      case "text": {
        const last = blocks[blocks.length - 1];
        if (last && last.type === "text") {
          blocks[blocks.length - 1] = {
            type: "text",
            text: last.text + message.data.text,
          };
        } else {
          blocks.push({ type: "text", text: message.data.text });
        }
        break;
      }
      case "thinking": {
        const last = blocks[blocks.length - 1];
        if (last && last.type === "thinking") {
          blocks[blocks.length - 1] = {
            type: "thinking",
            text: last.text + message.data.text,
          };
        } else {
          blocks.push({ type: "thinking", text: message.data.text });
        }
        break;
      }
      case "toolUse":
        blocks.push({
          type: "toolUse",
          id: message.data.id,
          name: message.data.name,
          input: message.data.input,
        });
        break;
      case "toolResult":
        blocks.push({
          type: "toolResult",
          id: message.data.id,
          content: message.data.content,
          isError: message.data.isError,
        });
        break;
      case "result":
        return {
          ...entry,
          costUsd: message.data.costUsd ?? entry.costUsd,
          subtype: message.data.subtype,
        };
      case "error":
        // The chat surface renders its own subscription prompt; keep the
        // platform's billing error out of the transcript.
        if (message.data.code !== "subscriptionRequired") {
          blocks.push({
            type: "text",
            text: `Error: ${message.data.message}`,
          });
        }
        break;
    }
    return { ...entry, blocks };
  });
}

function updateLastAi(
  entries: TranscriptEntry[],
  update: (
    entry: Extract<TranscriptEntry, { role: "assistant" }>,
  ) => TranscriptEntry,
): TranscriptEntry[] {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.role === "assistant") {
      const next = [...entries];
      next[index] = update(entry);
      return next;
    }
  }
  return [
    ...entries,
    update({
      role: "assistant",
      id: `ai-${entries.length}`,
      blocks: [],
      done: false,
    }),
  ];
}

function normalizeTranscriptEntry(
  payload: TranscriptEntry,
  fallbackId: number,
): TranscriptEntry {
  if (payload.role === "user") {
    return {
      role: "user",
      id: payload.id || `user-${fallbackId}`,
      text: typeof payload.text === "string" ? payload.text : "",
      contextAttachments: payload.contextAttachments,
    };
  }
  return {
    role: "assistant",
    id: payload.id || `ai-${fallbackId}`,
    blocks: Array.isArray(payload.blocks) ? payload.blocks : [],
    subtype: payload.subtype,
    costUsd: payload.costUsd,
    done: payload.done ?? true,
  };
}

function toContextInput(
  attachment: AiContextAttachment,
): AiContextAttachmentInput {
  return {
    kind: attachment.kind,
    label: attachment.label,
    payload: attachment.payload,
  };
}

function userPromptsFromEntries(entries: TranscriptEntry[]) {
  return entries
    .filter(
      (entry): entry is Extract<TranscriptEntry, { role: "user" }> =>
        entry.role === "user",
    )
    .map((entry) => entry.text.trim())
    .filter(Boolean);
}
