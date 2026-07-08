import {
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
import {
  settingsFieldClassName,
  settingsInputClassName,
  settingsSectionClassName,
} from "@/features/settings/settings-styles";
import { TextEditorPreview } from "@/features/settings/TextEditorPreview";
import { useTheme } from "@/ui";

export function TextEditorSettingsSection() {
  const { resolvedTheme } = useTheme();
  const {
    error,
    fontOptions,
    fontsError,
    fontsLoading,
    loading,
    saving,
    settings,
    setTextEditorSettings,
  } = useAppSettings();
  const textEditorSettings = settings.textEditor;
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

  return (
    <section className={settingsSectionClassName} aria-labelledby="text-editor">
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

        <label className="col-span-full flex min-w-0 items-start gap-2 text-[11.5px] font-semibold leading-snug text-cg-fg">
          <input
            checked={textEditorSettings.formatOnSave}
            className="mt-0.5 size-3.5 flex-none accent-cg-focus"
            onChange={(event) => {
              setTextEditorSettings({
                formatOnSave: event.currentTarget.checked,
              });
            }}
            type="checkbox"
          />
          <span>Format on save (JSON files)</span>
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
