import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import "./primus-specular.css";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Desative somente quando o componente estiver dentro de uma animação própria. */
  specular?: boolean;
}

/** Movimento baseado no SpecularButton do React Bits, mantendo o elemento e o evento nativos. */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      specular = true,
      onPointerMove,
      onPointerLeave,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const actualVariant = variant ?? "default";
    const specularEnabled =
      specular && actualVariant !== "ghost" && actualVariant !== "link" && size !== "icon";

    function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
      if (specularEnabled && (event.pointerType === "mouse" || event.pointerType === "pen")) {
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
          const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
          event.currentTarget.style.setProperty("--primus-specular-x", `${x}%`);
          event.currentTarget.style.setProperty("--primus-specular-y", `${y}%`);
        }
      }
      onPointerMove?.(event);
    }

    function handlePointerLeave(event: React.PointerEvent<HTMLButtonElement>) {
      if (specularEnabled) {
        event.currentTarget.style.removeProperty("--primus-specular-x");
        event.currentTarget.style.removeProperty("--primus-specular-y");
      }
      onPointerLeave?.(event);
    }

    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
          specularEnabled && "primus-specular-button",
        )}
        ref={ref}
        data-specular-variant={specularEnabled ? actualVariant : undefined}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
