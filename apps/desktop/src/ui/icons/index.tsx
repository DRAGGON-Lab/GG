import type { LucideProps } from "lucide-react";
import * as React from "react";
import { siAnthropic, siGoogle, type SimpleIcon } from "simple-icons";

import { cx } from "@/ui/class-name";

export type { LucideIcon } from "lucide-react";

export {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Axis3d,
  Binary,
  BookOpen,
  BookOpenCheck,
  ChartScatter,
  ChartNoAxesCombined,
  Blocks,
  Bot,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  CircleDashed,
  Code2,
  Copy,
  CornerDownRight,
  Database,
  Eye,
  EyeOff,
  Dices,
  Dna,
  FileText,
  Folder,
  FolderOpen,
  GripVertical,
  Grid3x3,
  History,
  Info,
  Infinity,
  KeyRound,
  LoaderCircle,
  Lock,
  LockOpen,
  MessageSquare,
  Monitor,
  Moon,
  MoreHorizontal,
  Orbit,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pause,
  Pi,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Sidebar,
  Search,
  SendHorizontal,
  Settings,
  SlidersHorizontal,
  Sigma,
  Sparkles,
  SquareFunction,
  SquareSplitHorizontal,
  SquareSplitVertical,
  SquareTerminal,
  Sun,
  Table2,
  Tag,
  TimerReset,
  Trash2,
  WandSparkles,
  Waypoints,
  X,
} from "lucide-react";

export type ProviderLogoId = "anthropic" | "google" | "openai" | "xai";

export type ProviderLogoProps = Omit<LucideProps, "ref"> & {
  provider: ProviderLogoId;
};

export const ProviderLogo = React.forwardRef<SVGSVGElement, ProviderLogoProps>(
  function ProviderLogo(
    {
      absoluteStrokeWidth: _absoluteStrokeWidth,
      className,
      provider,
      size = 24,
      ...props
    },
    ref,
  ) {
    const icon = providerLogoIconById[provider];

    return (
      <svg
        className={cx("fill-current stroke-none", className)}
        height={size}
        ref={ref}
        viewBox={icon.viewBox ?? "0 0 24 24"}
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d={icon.path} />
      </svg>
    );
  },
);

type ProviderBrandIcon = SimpleIcon & {
  viewBox?: string;
};

const openAiLogoIcon = {
  hex: "000000",
  path: "M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z",
  slug: "openai",
  source: "https://openai.com/",
  svg: "",
  title: "OpenAI",
  viewBox: "0 0 256 260",
} as const satisfies ProviderBrandIcon;

const xAiLogoIcon = {
  hex: "000000",
  path: "M0.12 182.71 234.14 516.92 338.15 516.92 104.13 182.71 0.12 182.71ZM0 516.92 104.08 516.92 156.08 442.67 104.04 368.34 0 516.92ZM466.04 0 361.96 0 182.1 256.86 234.15 331.18 466.04 0ZM380.78 516.92 466.04 516.92 466.04 37.16 380.78 158.92 380.78 516.92Z",
  slug: "xai",
  source: "https://x.ai/legal/brand-guidelines",
  svg: "",
  title: "xAI",
  viewBox: "0 0 466.04 516.93",
} as const satisfies ProviderBrandIcon;

const providerLogoIconById: Record<ProviderLogoId, ProviderBrandIcon> = {
  anthropic: siAnthropic,
  google: siGoogle,
  openai: openAiLogoIcon,
  xai: xAiLogoIcon,
};
