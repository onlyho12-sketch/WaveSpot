// 확인 창 (되돌리기 어려운 동작 전에 한 번 더 묻기)
import * as Dialog from "@radix-ui/react-dialog"
import type { ReactNode } from "react"
import { Button } from "./button"

export function Confirm({ open, onOpenChange, title, children, action, onConfirm, busy }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  children?: ReactNode
  action: string
  onConfirm: () => void
  busy?: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-fg/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface p-5 shadow-[0_8px_32px_rgba(16,24,40,0.2)] outline-none">
          <Dialog.Title className="text-lg font-bold">{title}</Dialog.Title>
          {children && <Dialog.Description asChild><div className="mt-2 text-fs15 text-fg-2">{children}</div></Dialog.Description>}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>취소</Button>
            <Button onClick={onConfirm} disabled={busy}>{action}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
