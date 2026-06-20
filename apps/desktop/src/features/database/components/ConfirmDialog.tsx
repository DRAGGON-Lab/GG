import { Button, Dialog } from "@/ui";
import { cx } from "@/ui/class-name";
import {
  appDialogBackdropClassName,
  appDialogPopupClassName,
} from "@/ui/primitives/dialog-classes";

type ConfirmDialogProps = {
  confirmLabel: string;
  description: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
};

export function ConfirmDialog({
  confirmLabel,
  description,
  onConfirm,
  onOpenChange,
  open,
  title,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Backdrop className={appDialogBackdropClassName} />
        <Dialog.Popup
          className={cx(
            appDialogPopupClassName,
            "grid w-[min(440px,calc(100vw_-_32px))] gap-3 p-4",
          )}
        >
          <header className="grid gap-1.5">
            <Dialog.Title className="m-0 text-[17px] font-[600] leading-tight tracking-[-0.015em] text-cg-fg">
              {title}
            </Dialog.Title>
            <Dialog.Description className="m-0 text-[12px] leading-relaxed text-cg-muted">
              {description}
            </Dialog.Description>
          </header>
          <footer className="flex items-center justify-end gap-2">
            <Dialog.Close
              render={
                <Button size="sm" variant="subtle">
                  Cancel
                </Button>
              }
            />
            <Button
              className="border-cg-danger bg-cg-danger text-white hover:brightness-[0.92]"
              onClick={onConfirm}
              size="sm"
            >
              {confirmLabel}
            </Button>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
