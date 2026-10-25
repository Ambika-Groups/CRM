// shadcn/ui-style Button: Radix Slot + class-variance-authority, styled by the approved component classes
// (design-tokens §5.2). One solid red "primary" per screen; destructive is outlined red.
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva("btn", {
  variants: {
    variant: { primary: "btn-primary", secondary: "btn-secondary", text: "btn-text", destructive: "btn-destructive" },
    size: { md: "", sm: "btn-sm" },
    block: { true: "btn-block", false: "" },
  },
  defaultVariants: { variant: "secondary", size: "md", block: false },
});

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, block, asChild, type, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} type={asChild ? undefined : (type ?? "button")} className={cn(buttonVariants({ variant, size, block }), className)} {...props} />;
});
Button.displayName = "Button";
