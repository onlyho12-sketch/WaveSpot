// 버튼 (cva 변형) · 태블릿 터치 대상 최소 44px
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white hover:bg-brand-hover",
        danger: "bg-danger text-white hover:bg-danger/90",
        ok: "bg-ok text-white hover:bg-ok/90",
        secondary: "border border-line-strong bg-surface text-fg hover:bg-subtle",
        subtle: "text-fg-2 hover:bg-fg/5",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-4 text-fs15",
        lg: "h-12 px-5 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
)

export function Button({ className, variant, size, asChild, ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button"
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
