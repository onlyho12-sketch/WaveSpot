// 상세 서랍 (Radix Dialog) · 태블릿은 오른쪽에서 목록 위로 겹쳐 열림 (Kismet 기기 상세 방식), 휴대폰은 아래에서
import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import type { ReactNode } from "react"

export function Sheet({ open, onOpenChange, title, description, top, children, footer }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  top?: ReactNode // 제목 아래 고정 영역 (사다리 단계 등)
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-fg/25" />
        <Dialog.Content
          className="fixed z-50 flex flex-col bg-surface shadow-[0_8px_32px_rgba(16,24,40,0.18)] outline-none
            inset-x-0 bottom-0 max-h-[90dvh] rounded-t-xl
            expanded:animate-drawer expanded:inset-y-0 expanded:right-0 expanded:left-auto expanded:max-h-none expanded:w-[min(540px,48vw)] expanded:rounded-none expanded:border-l expanded:border-line"
        >
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-bold">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-0.5 text-sm text-fg-2">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="-mr-2 grid size-10 place-items-center rounded-md text-fg-2 hover:bg-fg/5" aria-label="닫기">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          {top && <div className="border-b border-line bg-subtle px-5 py-4">{top}</div>}
          <div className="flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
