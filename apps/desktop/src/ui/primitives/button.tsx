import {
  Button as BaseButton,
  type ButtonProps as BaseButtonProps,
  type ButtonState,
} from "@base-ui/react/button";
import * as React from "react";

import { composeClassName } from "@/ui/class-name";
import { SendHorizontal } from "@/ui/icons";

export type ButtonVariant = "default" | "subtle" | "ghost" | "bare";
export type ButtonSize = "sm" | "md" | "icon" | "none";

const buttonBaseClassName =
  "inline-flex appearance-none cursor-default items-center justify-center gap-1.5 whitespace-nowrap border font-[inherit] text-[13px] leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cg-focus disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 [&>svg]:block [&>svg]:shrink-0";

const buttonSizeClassName: Record<ButtonSize, string> = {
  icon: "size-8 p-0",
  md: "h-8 px-[11px]",
  none: "",
  sm: "h-[26px] px-[9px]",
};

/* Pressable surfaces acknowledge the press (brand motion: strong ease-out,
   subtle scale). `bare` opts out — it backs list rows and rail items where
   a scale would read as jitter. */
const buttonPressClassName =
  "transition-[transform,background-color,border-color,color] duration-150 ease-out-strong active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

const buttonVariantClassName: Record<ButtonVariant, string> = {
  bare: "border-transparent bg-transparent",
  default: `rounded-cg-md border-cg-accent bg-cg-accent text-cg-accent-fg hover:text-cg-accent-fg hover:brightness-[0.92] ${buttonPressClassName}`,
  ghost: `rounded-cg-md border-transparent bg-transparent text-cg-muted hover:border-cg-border-strong hover:bg-cg-surface-hover ${buttonPressClassName}`,
  subtle: `rounded-cg-md border-cg-border bg-cg-surface text-cg-fg hover:border-cg-border-strong hover:bg-cg-surface-hover ${buttonPressClassName}`,
};

export interface ButtonProps extends BaseButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLElement, ButtonProps>(
  (
    { className, variant = "default", size = "md", type = "button", ...props },
    ref,
  ) => (
    <BaseButton
      ref={ref}
      className={composeClassName<ButtonState>(
        buttonBaseClassName,
        buttonSizeClassName[size],
        buttonVariantClassName[variant],
        className,
      )}
      data-size={size}
      data-variant={variant}
      type={type}
      {...props}
    />
  ),
);

Button.displayName = "Button";

export interface IconButtonProps extends Omit<
  ButtonProps,
  "children" | "size"
> {
  children: React.ReactNode;
  label: string;
}

export const IconButton = React.forwardRef<HTMLElement, IconButtonProps>(
  ({ children, label, ...props }, ref) => (
    <Button ref={ref} aria-label={label} size="icon" {...props}>
      {children}
    </Button>
  ),
);

IconButton.displayName = "IconButton";

export interface SendButtonProps extends Omit<
  ButtonProps,
  "children" | "size" | "variant"
> {
  iconSize?: number;
  label?: string;
}

const sendButtonClassName =
  "h-[34px] min-h-[34px] w-[34px] min-w-[34px] rounded-[7px] border-cg-accent bg-cg-accent p-0 text-cg-accent-fg shadow-[inset_0_1px_0_color-mix(in_srgb,var(--cg-accent-fg),transparent_78%)] hover:border-cg-focus hover:bg-cg-focus hover:text-cg-accent-fg hover:brightness-100";

export const SendButton = React.forwardRef<HTMLElement, SendButtonProps>(
  (
    {
      className,
      iconSize = 15,
      label = "Send",
      title,
      type = "button",
      ...props
    },
    ref,
  ) => (
    <Button
      ref={ref}
      aria-label={label}
      className={composeClassName<ButtonState>(sendButtonClassName, className)}
      size="none"
      title={title ?? label}
      type={type}
      variant="default"
      {...props}
    >
      <SendHorizontal aria-hidden="true" size={iconSize} strokeWidth={1.9} />
    </Button>
  ),
);

SendButton.displayName = "SendButton";
