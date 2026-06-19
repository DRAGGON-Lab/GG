import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";

import { BackupSettingsSection } from "@/features/backup";
import {
  type ActivityRailItemId,
  DEFAULT_ACTIVITY_ORDER,
  DEFAULT_HIDDEN_ACTIVITY_ITEMS,
  normalizeTextEditorFontSize,
  TEXT_EDITOR_FONT_SIZE_MAX,
  TEXT_EDITOR_FONT_SIZE_MIN,
  TEXT_EDITOR_FONT_SIZE_STEP,
  type TextEditorFontOption,
  type TextEditorKeymap,
  textEditorKeymapOptions,
  type TextEditorTheme,
  textEditorThemeOptions,
  useAppSettings,
} from "@/features/settings";
import { AiMemorySettingsSection } from "@/features/settings/AiMemorySettingsSection";
import { AiProvidersSettingsSection } from "@/features/settings/AiProvidersSettingsSection";
import { McpServersSettingsSection } from "@/features/settings/McpServersSettingsSection";
import { SkillsSettingsSection } from "@/features/settings/SkillsSettingsSection";
import { TextEditorPreview } from "@/features/settings/TextEditorPreview";
import { activityItemByMode } from "@/pages/activity-items";
import type { PageRuntime } from "@/pages/page.types";
import {
  ArrowDown,
  ArrowUp,
  BioEngStudioWordmark,
  Button,
  Database,
  Eye,
  EyeOff,
  GripVertical,
  RotateCcw,
  useTheme,
} from "@/ui";

const settingsFieldClassName =
  "grid gap-[7px] [&>span]:text-[11px] [&>span]:font-bold [&>span]:leading-none [&>span]:text-cg-muted";

const settingsInputClassName =
  "h-8 w-full min-w-0 rounded-[7px] border border-cg-border bg-cg-surface px-2.5 font-[inherit] text-[13px] leading-none text-cg-fg outline-0 hover:border-cg-border-strong focus-visible:border-cg-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus";

const settingsSectionClassName =
  "grid max-w-[760px] gap-3.5 [@container(max-width:520px)]:gap-3";

const activityRailButtonClassName =
  "size-7 rounded-[6px] border-transparent bg-transparent p-0 text-cg-muted hover:border-transparent hover:bg-cg-surface-hover hover:text-cg-fg";

export function SettingsPage({ openPageInNewTab }: PageRuntime) {
  const { resolvedTheme } = useTheme();
  const [activeActivityMode, setActiveActivityMode] =
    useState<ActivityRailItemId | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const {
    error,
    fontOptions,
    fontsError,
    fontsLoading,
    loading,
    saving,
    settings,
    setActivityRailSettings,
    setTextEditorSettings,
  } = useAppSettings();
  const textEditorSettings = settings.textEditor;
  const activityOrder = settings.activityOrder;
  const hiddenActivityItems = settings.hiddenActivityItems;
  const activeActivityItem = activeActivityMode
    ? activityItemByMode[activeActivityMode]
    : null;
  const defaultActivityRailSelected =
    isActivityOrderDefault(activityOrder) &&
    isHiddenActivityItemsDefault(hiddenActivityItems);
  const storageStatus = loading
    ? "Loading"
    : fontsLoading
      ? "Loading Fonts"
      : saving
        ? "Saving"
        : error || fontsError
          ? "Storage Error"
          : "Saved";
  const selectableFontOptions = ensureCurrentFontOption(
    fontOptions,
    textEditorSettings.fontFamily,
  );

  function setFontSize(value: string) {
    setTextEditorSettings({
      fontSize: normalizeTextEditorFontSize(value),
    });
  }

  function moveActivityOrderItem(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;

    if (nextIndex < 0 || nextIndex >= activityOrder.length) {
      return;
    }

    const nextActivityOrder = [...activityOrder];
    const [item] = nextActivityOrder.splice(index, 1);
    nextActivityOrder.splice(nextIndex, 0, item);
    setActivityRailSettings({ activityOrder: nextActivityOrder });
  }

  function toggleActivityVisibility(activityMode: ActivityRailItemId) {
    setActivityRailSettings({
      hiddenActivityItems: hiddenActivityItems.includes(activityMode)
        ? hiddenActivityItems.filter((itemId) => itemId !== activityMode)
        : [...hiddenActivityItems, activityMode],
    });
  }

  function handleActivityDragStart(event: DragStartEvent) {
    setActiveActivityMode(event.active.id as ActivityRailItemId);
  }

  function handleActivityDragEnd(event: DragEndEvent) {
    const activeId = event.active.id as ActivityRailItemId;
    const overId = event.over?.id as ActivityRailItemId | undefined;
    setActiveActivityMode(null);

    if (!overId || activeId === overId) {
      return;
    }

    const oldIndex = activityOrder.indexOf(activeId);
    const newIndex = activityOrder.indexOf(overId);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    setActivityRailSettings({
      activityOrder: arrayMove(activityOrder, oldIndex, newIndex),
    });
  }

  return (
    <div className="h-full min-h-0 min-w-0 overflow-auto bg-cg-editor [container-type:inline-size]">
      <div className="min-w-0 px-[22px] py-[18px] [@container(max-width:520px)]:p-3.5 [@container(max-width:380px)]:p-3">
        <AiProvidersSettingsSection />

        <BackupSettingsSection />

        <AiMemorySettingsSection />

        <SkillsSettingsSection />

        <McpServersSettingsSection />

        <section
          className={`${settingsSectionClassName} mb-6`}
          aria-labelledby="activity-rail"
        >
          <header className="flex min-w-0 items-center justify-between gap-3 border-b border-cg-border pb-2.5 [@container(max-width:520px)]:items-start [@container(max-width:520px)]:gap-2 [@container(max-width:520px)]:self-start [@container(max-width:520px)]:flex-col">
            <h2
              className="m-0 text-[14px] font-bold leading-none text-cg-fg"
              id="activity-rail"
            >
              Activity Rail
            </h2>
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="flex-none text-[11px] font-semibold leading-none text-cg-muted [&[data-error]]:text-cg-danger"
                data-error={error || fontsError ? "" : undefined}
              >
                {storageStatus}
              </span>
              <Button
                className="h-7 rounded-[6px] px-2 text-[11.5px]"
                disabled={defaultActivityRailSelected}
                onClick={() => {
                  setActivityRailSettings({
                    activityOrder: DEFAULT_ACTIVITY_ORDER,
                    hiddenActivityItems: DEFAULT_HIDDEN_ACTIVITY_ITEMS,
                  });
                }}
                size="none"
                variant="ghost"
              >
                <RotateCcw aria-hidden="true" size={13} strokeWidth={1.8} />
                Reset
              </Button>
            </div>
          </header>

          <DndContext
            collisionDetection={closestCenter}
            onDragCancel={() => setActiveActivityMode(null)}
            onDragEnd={handleActivityDragEnd}
            onDragStart={handleActivityDragStart}
            sensors={sensors}
          >
            <SortableContext
              items={activityOrder}
              strategy={verticalListSortingStrategy}
            >
              <div className="grid gap-1.5">
                {activityOrder.map((activityMode, index) => {
                  const first = index === 0;
                  const last = index === activityOrder.length - 1;

                  return (
                    <SortableActivityOrderRow
                      activityMode={activityMode}
                      dragging={activeActivityMode === activityMode}
                      first={first}
                      hidden={hiddenActivityItems.includes(activityMode)}
                      key={activityMode}
                      last={last}
                      onMove={moveActivityOrderItem}
                      onToggleVisibility={toggleActivityVisibility}
                      rowIndex={index}
                    />
                  );
                })}
              </div>
            </SortableContext>

            <DragOverlay>
              {activeActivityMode && activeActivityItem ? (
                <ActivityOrderRowContent
                  Icon={activeActivityItem.Icon}
                  hidden={hiddenActivityItems.includes(activeActivityMode)}
                  label={activeActivityItem.label}
                  overlay
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </section>

        <section
          className={settingsSectionClassName}
          aria-labelledby="text-editor"
        >
          <header className="flex min-w-0 items-center justify-between gap-3 border-b border-cg-border pb-2.5 [@container(max-width:520px)]:items-start [@container(max-width:520px)]:gap-2 [@container(max-width:520px)]:self-start [@container(max-width:520px)]:flex-col">
            <h2
              className="m-0 text-[14px] font-bold leading-none text-cg-fg"
              id="text-editor"
            >
              Text Editor
            </h2>
            <span
              className="flex-none text-[11px] font-semibold leading-none text-cg-muted [&[data-error]]:text-cg-danger"
              data-error={error || fontsError ? "" : undefined}
            >
              {storageStatus}
            </span>
          </header>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3 [@container(max-width:520px)]:gap-2.5">
            <label className={settingsFieldClassName}>
              <span>Theme</span>
              <select
                aria-label="Text editor theme"
                className={settingsInputClassName}
                onChange={(event) => {
                  setTextEditorSettings({
                    theme: event.currentTarget.value as TextEditorTheme,
                  });
                }}
                value={textEditorSettings.theme}
              >
                {textEditorThemeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={settingsFieldClassName}>
              <span>Keymap</span>
              <select
                aria-label="Text editor keymap"
                className={settingsInputClassName}
                onChange={(event) => {
                  setTextEditorSettings({
                    keymap: event.currentTarget.value as TextEditorKeymap,
                  });
                }}
                value={textEditorSettings.keymap}
              >
                {textEditorKeymapOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={settingsFieldClassName}>
              <span>Font</span>
              <select
                aria-label="Text editor font"
                className={settingsInputClassName}
                onChange={(event) => {
                  setTextEditorSettings({
                    fontFamily: event.currentTarget.value,
                  });
                }}
                value={textEditorSettings.fontFamily}
              >
                {selectableFontOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={`${settingsFieldClassName} col-span-full`}>
              <span>Default Text Size</span>
              <div className="grid grid-cols-[minmax(0,1fr)_74px] items-center gap-2.5 [@container(max-width:380px)]:grid-cols-1">
                <input
                  aria-label="Text editor font size"
                  className="w-full accent-cg-accent"
                  max={TEXT_EDITOR_FONT_SIZE_MAX}
                  min={TEXT_EDITOR_FONT_SIZE_MIN}
                  onChange={(event) => setFontSize(event.currentTarget.value)}
                  step={TEXT_EDITOR_FONT_SIZE_STEP}
                  type="range"
                  value={textEditorSettings.fontSize}
                />
                <input
                  aria-label="Text editor font size value"
                  className={`${settingsInputClassName} text-right [@container(max-width:380px)]:w-[74px] [@container(max-width:380px)]:justify-self-end`}
                  max={TEXT_EDITOR_FONT_SIZE_MAX}
                  min={TEXT_EDITOR_FONT_SIZE_MIN}
                  onChange={(event) => setFontSize(event.currentTarget.value)}
                  step={TEXT_EDITOR_FONT_SIZE_STEP}
                  type="number"
                  value={textEditorSettings.fontSize}
                />
              </div>
            </label>
          </div>

          <TextEditorPreview
            resolvedTheme={resolvedTheme}
            settings={textEditorSettings}
          />
        </section>

        <section
          className={`${settingsSectionClassName} mt-6`}
          aria-labelledby="advanced"
        >
          <header className="flex min-w-0 items-center justify-between gap-3 border-b border-cg-border pb-2.5">
            <h2
              className="m-0 text-[14px] font-bold leading-none text-cg-fg"
              id="advanced"
            >
              Advanced
            </h2>
          </header>

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-[7px] border border-cg-border bg-cg-surface px-3 py-2.5">
            <div className="grid min-w-0 gap-1.5">
              <span className="text-[12.5px] font-[600] leading-none text-cg-fg">
                Database Inspector
              </span>
              <span className="text-[11.5px] leading-relaxed text-cg-muted">
                Browse tables and run SQL against the app's local SQLite
                database.
              </span>
            </div>
            <Button
              onClick={() => openPageInNewTab?.("database")}
              size="sm"
              variant="subtle"
            >
              <Database aria-hidden="true" size={13} strokeWidth={1.9} />
              Open
            </Button>
          </div>
        </section>

        <footer className="mt-2 grid max-w-[760px] justify-items-center gap-2 border-t border-cg-border pb-2 pt-7">
          <BioEngStudioWordmark className="h-12 w-auto text-cg-muted" />
          <p className="m-0 text-[11.5px] leading-none text-cg-muted">
            The Biological Engineering IDE
          </p>
        </footer>
      </div>
    </div>
  );
}

function isActivityOrderDefault(activityOrder: readonly ActivityRailItemId[]) {
  return (
    activityOrder.length === DEFAULT_ACTIVITY_ORDER.length &&
    activityOrder.every(
      (activityMode, index) => activityMode === DEFAULT_ACTIVITY_ORDER[index],
    )
  );
}

function isHiddenActivityItemsDefault(
  hiddenActivityItems: readonly ActivityRailItemId[],
) {
  return (
    hiddenActivityItems.length === DEFAULT_HIDDEN_ACTIVITY_ITEMS.length &&
    hiddenActivityItems.every(
      (activityMode, index) =>
        activityMode === DEFAULT_HIDDEN_ACTIVITY_ITEMS[index],
    )
  );
}

function SortableActivityOrderRow({
  activityMode,
  dragging,
  first,
  hidden,
  last,
  onMove,
  onToggleVisibility,
  rowIndex,
}: {
  activityMode: ActivityRailItemId;
  dragging: boolean;
  first: boolean;
  hidden: boolean;
  last: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onToggleVisibility: (activityMode: ActivityRailItemId) => void;
  rowIndex: number;
}) {
  const item = activityItemByMode[activityMode];
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isSorting,
  } = useSortable({ id: activityMode });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ActivityOrderRowContent
        Icon={item.Icon}
        dragging={dragging}
        first={first}
        hidden={hidden}
        label={item.label}
        last={last}
        listeners={listeners}
        onMove={onMove}
        onToggleVisibility={() => onToggleVisibility(activityMode)}
        rowIndex={rowIndex}
        sorting={isSorting}
        sortableAttributes={attributes}
      />
    </div>
  );
}

function ActivityOrderRowContent({
  Icon,
  dragging = false,
  first = false,
  hidden = false,
  label,
  last = false,
  listeners,
  onMove,
  onToggleVisibility,
  overlay = false,
  rowIndex = 0,
  sorting = false,
  sortableAttributes,
}: {
  Icon: (typeof activityItemByMode)[ActivityRailItemId]["Icon"];
  dragging?: boolean;
  first?: boolean;
  hidden?: boolean;
  label: string;
  last?: boolean;
  listeners?: ReturnType<typeof useSortable>["listeners"];
  onMove?: (index: number, direction: -1 | 1) => void;
  onToggleVisibility?: () => void;
  overlay?: boolean;
  rowIndex?: number;
  sorting?: boolean;
  sortableAttributes?: ReturnType<typeof useSortable>["attributes"];
}) {
  return (
    <div
      aria-label={`Reorder ${label}`}
      className={`grid h-10 min-w-0 select-none grid-cols-[18px_18px_minmax(0,1fr)_max-content] items-center gap-2 rounded-[7px] border border-cg-border bg-cg-surface px-2.5 text-cg-fg ${
        dragging ? "opacity-35" : ""
      } ${hidden && !overlay ? "bg-cg-editor text-cg-muted opacity-75" : ""} ${
        sorting ? "transition-[box-shadow,opacity] duration-150" : ""
      } ${
        overlay
          ? "cursor-grabbing border-cg-accent bg-cg-surface-hover shadow-[0_14px_34px_rgb(20_34_30/0.22)] ring-1 ring-cg-accent/25"
          : ""
      }`}
      title={`Drag ${label} to reorder`}
    >
      <button
        aria-label={`Drag ${label}`}
        className="grid size-[18px] cursor-grab place-items-center rounded-[4px] border-0 bg-transparent p-0 text-cg-muted outline-0 hover:bg-cg-surface-hover hover:text-cg-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus active:cursor-grabbing"
        type="button"
        {...sortableAttributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" size={15} strokeWidth={1.7} />
      </button>
      <Icon
        aria-hidden="true"
        className={hidden ? "text-cg-muted opacity-65" : "text-cg-muted"}
        size={17}
        strokeWidth={1.75}
      />
      <span className="min-w-0 truncate text-[12.5px] font-semibold leading-none">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <Button
          aria-label={hidden ? `Show ${label}` : `Hide ${label}`}
          className={activityRailButtonClassName}
          disabled={overlay}
          onClick={onToggleVisibility}
          size="none"
          title={hidden ? `Show ${label}` : `Hide ${label}`}
          variant="bare"
        >
          {hidden ? (
            <EyeOff aria-hidden="true" size={14} strokeWidth={1.8} />
          ) : (
            <Eye aria-hidden="true" size={14} strokeWidth={1.8} />
          )}
        </Button>
        <Button
          aria-label={`Move ${label} up`}
          className={activityRailButtonClassName}
          disabled={first || overlay}
          onClick={() => onMove?.(rowIndex, -1)}
          size="none"
          title={`Move ${label} up`}
          variant="bare"
        >
          <ArrowUp aria-hidden="true" size={14} strokeWidth={1.8} />
        </Button>
        <Button
          aria-label={`Move ${label} down`}
          className={activityRailButtonClassName}
          disabled={last || overlay}
          onClick={() => onMove?.(rowIndex, 1)}
          size="none"
          title={`Move ${label} down`}
          variant="bare"
        >
          <ArrowDown aria-hidden="true" size={14} strokeWidth={1.8} />
        </Button>
      </div>
    </div>
  );
}

function ensureCurrentFontOption(
  fontOptions: readonly TextEditorFontOption[],
  currentFontFamily: string,
): readonly TextEditorFontOption[] {
  if (fontOptions.some((option) => option.value === currentFontFamily)) {
    return fontOptions;
  }

  return [
    {
      label: "Current Font",
      value: currentFontFamily,
    },
    ...fontOptions,
  ];
}
