import type {
  PermissionBehavior,
  PermissionPrompt,
  PromptRequest,
  SessionMessageNotification,
  WorkspaceRequest,
} from "@protocol";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  AiContextAttachmentInput,
  AiConversation,
  AiConversationSummary,
} from "@/features/ai/core/ai-types";

export function agentSend(request: PromptRequest) {
  return invoke<void>("agent_send", { request });
}

export function agentInterrupt(conversationId: string) {
  return invoke<void>("agent_interrupt", { conversationId });
}

export function aiConversationsList() {
  return invoke<AiConversationSummary[]>("ai_conversations_list");
}

export function aiConversationCreate(input: {
  agentId?: string;
  contextAttachments?: AiContextAttachmentInput[];
  title?: string | null;
}) {
  return invoke<AiConversation>("ai_conversation_create", {
    input,
  });
}

export function aiConversationGet(conversationId: string) {
  return invoke<AiConversation | null>("ai_conversation_get", {
    conversationId,
  });
}

export function aiConversationDelete(conversationId: string) {
  return invoke<boolean>("ai_conversation_delete", {
    conversationId,
  });
}

export function aiConversationContextSet(
  conversationId: string,
  contextAttachments: AiContextAttachmentInput[],
) {
  return invoke<AiConversation | null>("ai_conversation_context_set", {
    conversationId,
    input: { contextAttachments },
  });
}

export function aiConversationTitleUpdate(
  conversationId: string,
  title: string,
) {
  return invoke<AiConversation | null>("ai_conversation_title_update", {
    conversationId,
    title,
  });
}

export function aiConversationTitleGenerate(prompts: string[]) {
  return invoke<string>("ai_conversation_title_generate", {
    input: { prompts },
  });
}

export function aiConversationModeSet(conversationId: string, mode: string) {
  return invoke<AiConversation | null>("ai_conversation_mode_set", {
    conversationId,
    mode,
  });
}

export function agentRespondPermission(
  requestId: string,
  behavior: PermissionBehavior,
  message?: string | null,
) {
  return invoke<void>("agent_respond_permission", {
    requestId,
    behavior,
    message: message ?? null,
  });
}

export function onAgentMessage(
  callback: (notification: SessionMessageNotification) => void,
) {
  return listen<SessionMessageNotification>("agent-message", (event) =>
    callback(event.payload),
  );
}

export function onAgentPermissionRequest(
  callback: (prompt: PermissionPrompt) => void,
) {
  return listen<PermissionPrompt>("agent-permission-request", (event) =>
    callback(event.payload),
  );
}

export function onAgentWorkspaceRequest(
  callback: (request: WorkspaceRequest) => void,
) {
  return listen<WorkspaceRequest>("agent-workspace-request", (event) =>
    callback(event.payload),
  );
}

/// Resolve a parked workspace request: `result` is the tool result returned to
/// the model (a string for reads, a structured value otherwise); `isError` marks
/// a failure the agent should see and recover from.
export function agentRespondWorkspaceRequest(
  requestId: string,
  result: unknown,
  isError: boolean,
) {
  return invoke<void>("agent_respond_workspace_request", {
    requestId,
    result,
    isError,
  });
}
