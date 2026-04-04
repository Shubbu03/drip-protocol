import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border text-sm font-medium transition duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-ring-offset)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] px-5 py-3 text-[color:var(--color-accent-foreground)] shadow-[0_14px_34px_-18px_var(--shadow-accent)] hover:-translate-y-0.5 hover:bg-[color:var(--color-accent-strong)]",
        secondary:
          "border-[color:var(--color-border-strong)] bg-[color:var(--color-panel)] px-5 py-3 text-[color:var(--color-foreground)] hover:-translate-y-0.5 hover:bg-[color:var(--color-panel-strong)]",
        ghost:
          "border-transparent px-4 py-2 text-[color:var(--color-muted-foreground)] hover:border-[color:var(--color-border)] hover:bg-[color:var(--color-panel)] hover:text-[color:var(--color-foreground)]",
      },
      size: {
        default: "min-h-12",
        sm: "min-h-10 px-4 py-2.5 text-xs tracking-[0.16em] uppercase",
        lg: "min-h-14 px-6 py-4 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
