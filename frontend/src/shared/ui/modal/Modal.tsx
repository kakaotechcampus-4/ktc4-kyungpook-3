import type { ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'

export interface ModalProps {
  /** 열림 상태는 호출자가 소유한다 */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 문구는 호출자가 준다. 비어도 요소 자체는 항상 그린다 */
  title: ReactNode
  description?: ReactNode
  /** 본문 커스텀 */
  children?: ReactNode
  /** 보통 ghost + primary 버튼 두 개. 문구는 호출자가 준다 */
  actions?: ReactNode
  /** 카드 폭. 기본 380 은 클래스가 준다 — 여기에 값을 주면 그 값이 덮는다 */
  width?: number
  /** 스크림의 접근성 이름. 구조에 속하므로 기본값을 둔다 */
  closeLabel?: string
  /** 카드에 덧붙인다 */
  className?: string
}

/* 표는 모듈 스코프에 둔다 — 렌더마다 다시 만들지 않는다.
   근거: m2-design-tokens.md §7-8, docs/impl-decision/2026-09-16-no-cn-clsx-tailwind-merge.md */

const OVERLAY = 'fixed inset-0 z-100 flex items-center justify-center p-24'

/** 스크림은 먹의 32% 알파다. 검정이 아니다 (§5-1 금지 목록과 어긋나지 않는다) */
const SCRIM = 'absolute inset-0 cursor-pointer bg-ink/32'

/* `relative` 는 실측표에 없지만 빠뜨릴 수 없다 — 스크림이 `absolute` 라서
   자리잡지 않은 카드는 스크림 아래로 깔린다. 쌓임 순서를 위한 한 개다. */
const CARD =
  'relative flex w-[380px] max-w-full flex-col gap-12 rounded-16 border border-line bg-surface p-24'

/* 17px 은 타이포 토큰 6종 밖이다 — docs/impl-decision/2026-09-16-modal-title-17px.md
   자간 -0.02em 은 `tracking-h3` 과 정확히 같은 값이라 임의값을 쓰지 않는다. */
const TITLE = 'text-[17px] font-bold tracking-h3 text-ink'

/* 줄 높이 1.7 은 `text-body` 토큰이 이미 달고 나온다 —
   `leading-*` 을 겹쳐 붙이면 그 1.7 을 덮어 버린다. */
const DESCRIPTION = 'text-body text-sub'

const ACTIONS = 'flex justify-end gap-8 pt-6'

/**
 * `@radix-ui/react-dialog` 의 `Root` `Portal` `Overlay` `Content` `Title` `Description` `Close` (§7-0 · §7-8).
 *
 * **닫기 X 버튼을 만들지 않는다.** 시안에 없다. 닫는 길은 세 개다 —
 * 스크림 클릭, `actions` 로 들어온 버튼, Esc(Radix 가 처리).
 * 스크림이 곧 닫기 조작이라서 `closeLabel` 이 그 이름이 된다.
 *
 * **여는/닫는 전환이 없다.** 줄이기를 켜지 않은 사람에게도 없다 — 시안에 전환이 없다.
 * 그래서 이 파일에는 `transition-*` 도 `animate-*` 도 한 개도 없다.
 *
 * `Title` 은 조건 없이 그린다. 없으면 Radix 가 콘솔 경고를 낸다.
 * `description` 을 안 주면 `aria-describedby` 를 명시적으로 지운다 — 같은 이유의 두 번째 경고를 막는다.
 *
 * 버튼을 안에 박지 않는다. `actions` 에 무엇이 들어올지는 호출부가 정한다 —
 * `취소`·`확인` 같은 문구도 컴포넌트가 갖지 않는다.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  width,
  closeLabel = '닫기',
  className,
}: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY}>
          <DialogPrimitive.Close className={SCRIM} aria-label={closeLabel} />

          <DialogPrimitive.Content
            className={[CARD, className].filter(Boolean).join(' ')}
            style={width === undefined ? undefined : { width }}
            {...(description === undefined ? { 'aria-describedby': undefined } : null)}
          >
            <DialogPrimitive.Title className={TITLE}>{title}</DialogPrimitive.Title>

            {description === undefined ? null : (
              <DialogPrimitive.Description className={DESCRIPTION}>
                {description}
              </DialogPrimitive.Description>
            )}

            {children}

            {actions === undefined ? null : <div className={ACTIONS}>{actions}</div>}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
