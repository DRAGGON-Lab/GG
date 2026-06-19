import { AgentMode } from "@protocol";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  AiContextAttachment,
  AiContextAttachmentInput,
  AiConversation,
} from "@/features/ai/core/ai-types";
import { AgentPermissionPrompt } from "@/features/ai/core/components/AgentPermissionPrompt";
import { AgentTranscript } from "@/features/ai/core/components/AgentTranscript";
import { useAiConversation } from "@/features/ai/core/useAgentSession";
import {
  Button,
  ChevronDown,
  LoaderCircle,
  SendButton,
  SquareSplitHorizontal,
  X,
} from "@/ui";

export type AiInitialGuide = {
  exampleLabel?: string;
  examplePrompt?: string;
};

export type AiSignedOutGuide = {
  title: string;
  message: string;
};

type AiSurfaceProps = {
  agentId?: string;
  autoStartPrompt?: string;
  compact?: boolean;
  conversationId?: string | null;
  contextAttachments?: AiContextAttachmentInput[];
  initialGuide?: AiInitialGuide;
  initialContextAttachments?: AiContextAttachmentInput[];
  initialTitle?: string;
  signedOutGuide?: AiSignedOutGuide;
  onClose?: () => void;
  onConversationReady?: (conversation: AiConversation) => void;
  onConversationUpdated?: (conversation: AiConversation) => void;
  onOpenInWorkbench?: (conversation: AiConversation) => void;
  onOpenSettings?: () => void;
  showContextChips?: boolean;
  showHeader?: boolean;
  /// Show the Review/Agentic autonomy toggle (the editor's workspace assistant,
  /// where the agent can edit files).
  showModeToggle?: boolean;
};

const iconButtonClassName =
  "size-7 rounded-[7px] border-transparent bg-transparent p-0 text-cg-muted hover:bg-cg-surface-hover hover:text-cg-fg";

/// The agent's autonomy modes, in ⇧Tab cycle order. The list drives both the
/// mode select and the keyboard cycle, so adding a mode is a one-line change.
const AGENT_MODES: ReadonlyArray<{
  value: AgentMode;
  label: string;
  caption: string;
}> = [
  {
    value: AgentMode.Review,
    label: "Review",
    caption: "You review each change",
  },
  {
    value: AgentMode.Agentic,
    label: "Agentic",
    caption: "Edits apply automatically",
  },
];

const agentModeFor = (mode: AgentMode) =>
  AGENT_MODES.find((entry) => entry.value === mode) ?? AGENT_MODES[0];

export function AiSurface({
  agentId,
  autoStartPrompt,
  compact = false,
  conversationId,
  contextAttachments,
  initialGuide,
  initialContextAttachments = [],
  initialTitle,
  signedOutGuide,
  onClose,
  onConversationReady,
  onConversationUpdated,
  onOpenInWorkbench,
  onOpenSettings,
  showContextChips = true,
  showHeader = true,
  showModeToggle = false,
}: AiSurfaceProps) {
  const {
    agentError,
    busy,
    conversation,
    entries,
    interrupt,
    loading,
    mode,
    permission,
    respondPermission,
    send,
    setMode,
  } = useAiConversation({
    agentId,
    conversationId,
    initialContextAttachments,
    initialTitle,
    onConversationReady,
    onConversationUpdated,
  });
  // With local API keys, the only gate is whether a provider key is configured.
  const setupRequired = agentError?.code === "credentialMissing";
  const [input, setInput] = useState("");
  const [guideDismissed, setGuideDismissed] = useState(false);
  const [prevConversationId, setPrevConversationId] = useState(conversationId);

  if (prevConversationId !== conversationId) {
    setPrevConversationId(conversationId);
    setInput("");
    setGuideDismissed(false);
  }
  const inputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const activeContext = useMemo(
    () =>
      contextAttachments ??
      conversation?.contextAttachments.map(toContextInput) ??
      initialContextAttachments,
    [contextAttachments, conversation, initialContextAttachments],
  );

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
    });
  }, [entries, busy, loading]);

  // Opt-in: kick off the conversation automatically when the surface opens
  // empty (e.g. a teaching session). Fires once per mounted surface — and
  // holds until the user is signed in, so a signed-out open shows the sign-in
  // state instead of a doomed request, then starts on its own after sign-in.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (
      !autoStartPrompt ||
      autoStartedRef.current ||
      setupRequired ||
      loading ||
      busy ||
      entries.length > 0
    ) {
      return;
    }
    autoStartedRef.current = true;
    send(autoStartPrompt, activeContext);
  }, [
    activeContext,
    autoStartPrompt,
    busy,
    entries.length,
    loading,
    send,
    setupRequired,
  ]);

  const submit = useCallback(() => {
    const prompt = input.trim();
    if (!prompt || busy || loading) {
      return;
    }
    send(prompt, activeContext);
    setInput("");
  }, [activeContext, busy, input, loading, send]);

  const useGuidePrompt = useCallback((prompt: string) => {
    setInput(prompt);
    setGuideDismissed(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const cycleMode = useCallback(() => {
    const index = AGENT_MODES.findIndex((entry) => entry.value === mode);
    const next = AGENT_MODES[(index + 1) % AGENT_MODES.length];
    setMode(next.value);
  }, [mode, setMode]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (showModeToggle && event.key === "Tab" && event.shiftKey) {
        event.preventDefault();
        cycleMode();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    },
    [cycleMode, showModeToggle, submit],
  );

  const title = conversation?.title || initialTitle || "AI";
  // An empty surface makes the setup state the main event, centered like the
  // initial guide; with a transcript on screen it sits inline below it.
  const showSetupHero = setupRequired && !entries.length && !loading;
  const showInitialGuide = Boolean(
    initialGuide &&
    !entries.length &&
    !busy &&
    !loading &&
    !permission &&
    !guideDismissed &&
    !setupRequired,
  );

  return (
    <div
      className={`grid h-full min-h-0 ${
        showHeader
          ? "grid-rows-[auto_minmax(0,1fr)_auto]"
          : "grid-rows-[minmax(0,1fr)_auto]"
      } overflow-hidden bg-cg-sidebar`}
    >
      {showHeader ? (
        <div className="flex min-w-0 items-center gap-2 border-b border-cg-border bg-cg-titlebar px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-none text-cg-fg">
            {title}
          </span>
          {onOpenInWorkbench && conversation ? (
            <Button
              className={iconButtonClassName}
              onClick={() => onOpenInWorkbench(conversation)}
              size="none"
              title="Open in workbench"
              variant="bare"
            >
              <SquareSplitHorizontal
                aria-hidden="true"
                size={14}
                strokeWidth={1.8}
              />
            </Button>
          ) : null}
          {onClose ? (
            <Button
              className={iconButtonClassName}
              onClick={onClose}
              size="none"
              title="Close"
              variant="bare"
            >
              <X aria-hidden="true" size={14} strokeWidth={1.9} />
            </Button>
          ) : null}
        </div>
      ) : null}

      <div
        className={[
          "grid min-h-0 overflow-auto p-3",
          showInitialGuide || showSetupHero
            ? "place-items-center"
            : "auto-rows-max content-start gap-3",
        ].join(" ")}
        ref={transcriptRef}
      >
        {showContextChips && activeContext.length && !showSetupHero ? (
          <ContextChips contextAttachments={activeContext} />
        ) : null}
        {entries.length ? (
          <AgentTranscript entries={entries} />
        ) : showSetupHero ? null : showInitialGuide && initialGuide ? (
          <AiInitialGuideCard
            guide={initialGuide}
            onUsePrompt={useGuidePrompt}
          />
        ) : (
          <div className="h-8" aria-hidden="true" />
        )}

        {permission ? (
          <AgentPermissionPrompt
            onRespond={respondPermission}
            prompt={permission}
          />
        ) : null}

        {setupRequired ? (
          <ApiKeyRequiredState
            message={
              signedOutGuide?.message ??
              "Add an API key for Anthropic, OpenAI, Gemini, or xAI in Settings to start chatting."
            }
            onOpenSettings={onOpenSettings}
            spacious={!compact && showSetupHero}
            title={signedOutGuide?.title ?? "Connect an AI provider"}
          />
        ) : null}

        {busy ? (
          <div className="flex items-center justify-between gap-2 text-[11.5px] text-cg-muted">
            <span className="flex items-center gap-2">
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
                size={13}
                strokeWidth={1.8}
              />
              Working...
            </span>
            <Button onClick={interrupt} size="sm" variant="ghost">
              Stop
            </Button>
          </div>
        ) : null}
      </div>

      <div className="border-t border-cg-border bg-cg-titlebar">
        {showModeToggle ? (
          <div className="flex items-center justify-between gap-2 px-2.5 pt-2.5">
            <ModePicker
              disabled={setupRequired}
              mode={mode}
              onChange={setMode}
            />
            <span className="min-w-0 truncate text-[10.5px] leading-none text-cg-muted">
              {agentModeFor(mode).caption}
            </span>
          </div>
        ) : null}
        <div className="grid grid-cols-[minmax(0,1fr)_34px] items-end gap-2 p-2.5">
          <input
            autoComplete="off"
            className="h-[34px] min-w-0 rounded-[7px] border border-cg-border bg-cg-editor px-2.5 font-[inherit] text-[12px] leading-none text-cg-fg outline-none placeholder:text-cg-muted focus-visible:border-cg-accent"
            disabled={loading || setupRequired}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              loading
                ? "Loading..."
                : setupRequired
                  ? "Add an API key in Settings"
                  : "Ask anything"
            }
            ref={inputRef}
            value={input}
          />
          <SendButton
            disabled={busy || loading || setupRequired || !input.trim()}
            onClick={submit}
          />
        </div>
      </div>
    </div>
  );
}

function ModePicker({
  disabled,
  mode,
  onChange,
}: {
  disabled?: boolean;
  mode: AgentMode;
  onChange: (mode: AgentMode) => void;
}) {
  return (
    <div className="relative inline-flex">
      <select
        aria-label="Agent mode"
        className="h-[26px] min-w-0 cursor-default appearance-none rounded-cg-md border border-cg-border bg-cg-editor py-1 pl-2 pr-[22px] font-[inherit] text-[11px] font-medium leading-none text-cg-fg outline-none transition-[transform,border-color,color] duration-150 ease-out-strong hover:border-cg-border-strong active:scale-[0.97] focus:outline-none focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100"
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value as AgentMode)}
        title="Switch agent mode (⇧Tab to cycle)"
        value={mode}
      >
        {AGENT_MODES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-cg-muted"
        size={12}
        strokeWidth={1.9}
      />
    </div>
  );
}

function ApiKeyRequiredState({
  message,
  onOpenSettings,
  spacious,
  title,
}: {
  message: string;
  onOpenSettings?: () => void;
  spacious?: boolean;
  title: string;
}) {
  return (
    <div
      className={[
        "mx-auto grid w-full max-w-[420px] gap-2 rounded-md border border-cg-border bg-cg-editor text-center",
        spacious ? "px-5 py-8" : "px-4 py-5",
      ].join(" ")}
    >
      <span className="text-[13px] font-semibold leading-none text-cg-fg">
        {title}
      </span>
      <span className="text-[12px] leading-[1.4] text-cg-muted">{message}</span>
      {onOpenSettings ? (
        <div className="mt-1 flex justify-center">
          <Button onClick={onOpenSettings} size="sm" variant="ghost">
            Open Settings
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AiInitialGuideCard({
  guide,
  onUsePrompt,
}: {
  guide: AiInitialGuide;
  onUsePrompt: (prompt: string) => void;
}) {
  if (!guide.examplePrompt) {
    return null;
  }

  return (
    <button
      className="mx-auto grid w-full max-w-[520px] cursor-default gap-[5px] rounded-md border border-[color-mix(in_srgb,var(--cg-accent),var(--cg-border)_70%)] bg-cg-editor px-2.5 py-[9px] text-left font-[inherit] outline-none transition-colors hover:border-[color-mix(in_srgb,var(--cg-accent),var(--cg-border)_42%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus"
      onClick={() => onUsePrompt(guide.examplePrompt ?? "")}
      type="button"
    >
      <span className="text-[10.5px] font-bold uppercase leading-none text-cg-accent">
        {guide.exampleLabel ?? "Try"}
      </span>
      <span className="min-w-0 whitespace-pre-wrap text-[12px] leading-[1.35] text-cg-fg">
        {guide.examplePrompt}
      </span>
    </button>
  );
}

function ContextChips({
  contextAttachments,
}: {
  contextAttachments: AiContextAttachmentInput[];
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {contextAttachments.map((attachment, index) => (
        <span
          className="max-w-full truncate rounded-[5px] border border-cg-border bg-cg-editor px-1.5 py-1 text-[10.5px] leading-none text-cg-muted"
          key={`${attachment.kind}-${attachment.label}-${index}`}
          title={attachment.label}
        >
          {attachment.label}
        </span>
      ))}
    </div>
  );
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
