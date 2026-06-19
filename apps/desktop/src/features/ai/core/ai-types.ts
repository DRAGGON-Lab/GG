import type { AgentMode, PromptContextAttachment } from "@protocol";

export type AiContextAttachmentInput = PromptContextAttachment;

export type AiContextAttachment = AiContextAttachmentInput & {
  id?: number | null;
};

export type AiConversationSummary = {
  agentId: string;
  contextAttachments: AiContextAttachment[];
  createdAt: string;
  id: string;
  messageCount: number;
  title: string;
  updatedAt: string;
};

export type AiConversation = {
  agentId: string;
  contextAttachments: AiContextAttachment[];
  createdAt: string;
  id: string;
  mode: AgentMode;
  title: string;
  transcriptEntries: AiTranscriptEntry[];
  updatedAt: string;
};

export type AiTranscriptEntry = {
  createdAt: string;
  id: number;
  payload: TranscriptEntry;
  role: TranscriptEntry["role"];
};

export type AiBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolUse"; id: string; name: string; input: unknown }
  | { type: "toolResult"; id: string; content: string; isError: boolean };

export type TranscriptEntry =
  | {
      role: "user";
      id: string;
      text: string;
      contextAttachments?: AiContextAttachmentInput[];
    }
  | {
      role: "assistant";
      id: string;
      blocks: AiBlock[];
      subtype?: string | null;
      costUsd?: number | null;
      done: boolean;
    };
