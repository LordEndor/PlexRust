import * as React from "react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function ContextMenu(props: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger(props: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />;
}

function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          "bg-popover/95 text-popover-foreground data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 z-[60] min-w-[13rem] overflow-hidden rounded-xl border p-1 shadow-lg backdrop-blur",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuLabel({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Label>) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      className={cn("text-muted-foreground truncate px-2 py-1.5 text-xs font-medium", className)}
      {...props}
    />
  );
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...props}
    />
  );
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator };
