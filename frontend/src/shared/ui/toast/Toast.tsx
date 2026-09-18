import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { Button } from '../button'

export interface ToastActionSpec {
  /** 문구는 호출자가 준다 — 되돌릴 수 있는 동작이면 되돌리기 계열 문구를 준다 */
  label: string
  onClick: () => void
}

export interface ToastProps extends Omit<
  ComponentPropsWithoutRef<typeof ToastPrimitive.Root>,
  'title'
> {
  title: ReactNode
  description?: ReactNode
  action?: ToastActionSpec
}

export type ToastProviderProps = ComponentPropsWithoutRef<typeof ToastPrimitive.Provider>

export type ToastViewportProps = ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>

/* 표는 모듈 스코프에 둔다 — 렌더마다 다시 만들지 않는다.
   근거: m2-design-tokens.md §7-9, docs/impl-decision/2026-09-16-no-cn-clsx-tailwind-merge.md

   §7-9 는 전부 제안값이다 — 캔버스 25장에 토스트가 한 개도 없다.
   docs/impl-decision/2026-09-16-toast-has-no-canvas.md */

const VIEWPORT = 'fixed right-24 bottom-24 z-100 flex flex-col gap-8'

/* 그림자가 없다. 흰 면 위의 흰 토스트를 1px 헤어라인 하나로 띄운다 —
   눈으로 확인하는 것은 M4 다. 반경 12 는 칸반 카드 단으로, 카드 16 보다 한 단 작다. */
const ROOT =
  'flex min-w-[280px] max-w-[380px] flex-col rounded-12 border border-line bg-surface px-16 py-14'

const TITLE = 'text-body font-semibold text-ink'

const DESCRIPTION = 'text-caption text-dim'

/** 액션 행은 Modal 의 실측 액션 행에서 값을 빌린다 — 토스트에는 실측이 없다 */
const ACTION_ROW = 'flex justify-end pt-6'

/** 액션 없을 때 6초, 있으면 10초 — 되돌릴 시간을 준다 */
const DURATION = 6000
const DURATION_WITH_ACTION = 10000

/**
 * `@radix-ui/react-toast` 의 `Provider` 를 감싸기만 한다. 스타일이 없다.
 *
 * **M2 는 이 Provider 를 어디에도 올리지 않는다.** 배선은 M3 의 `app/providers` 몫이다.
 * 테스트와 M3 이 Radix 패키지를 직접 import 하지 않도록 이름만 여기서 내보낸다.
 */
export function ToastProvider(props: ToastProviderProps) {
  return <ToastPrimitive.Provider {...props} />
}

/** 우측 하단에 쌓이는 자리. Provider 안에 한 번만 올린다 */
export function ToastViewport({ className, ...rest }: ToastViewportProps) {
  return (
    <ToastPrimitive.Viewport
      className={[VIEWPORT, className].filter(Boolean).join(' ')}
      {...rest}
    />
  )
}

/**
 * 짧게 떴다 사라지는 알림 (§7-9).
 *
 * **`variant='error'` 를 만들지 않는다.** 오류는 토스트로 처리하지 않는다 — 사라지면 대체 경로를 놓친다.
 * 오류는 `ErrorText` 나 화면 안의 자리에 남긴다.
 *
 * **그림자가 없다.** 금지 목록이다. 깊이는 1px 헤어라인이 낸다.
 *
 * **전환이 없다.** `transition-*` 도 `animate-*` 도 붙이지 않는다 — 토큰이 애니메이션 스케일을
 * 비웠고 시안에 근거가 없다. 줄이기를 켠 사람에게 즉시 표시·제거라는 §7-9 의 요구가 그대로 만족된다.
 *
 * 문구를 컴포넌트가 갖지 않는다. 제목·설명·액션 라벨 전부 호출자가 준다.
 * 액션은 Radix 에서 닫기를 겸한다 — 눌리면 토스트가 닫힌다. 그래서 별도의 X 를 두지 않는다.
 */
export function Toast({ title, description, action, duration, className, ...rest }: ToastProps) {
  return (
    <ToastPrimitive.Root
      className={[ROOT, className].filter(Boolean).join(' ')}
      duration={duration ?? (action === undefined ? DURATION : DURATION_WITH_ACTION)}
      {...rest}
    >
      <ToastPrimitive.Title className={TITLE}>{title}</ToastPrimitive.Title>

      {description === undefined ? null : (
        <ToastPrimitive.Description className={DESCRIPTION}>
          {description}
        </ToastPrimitive.Description>
      )}

      {action === undefined ? null : (
        <div className={ACTION_ROW}>
          <ToastPrimitive.Action asChild altText={action.label}>
            <Button variant="ghost" size="md-compact" onClick={action.onClick}>
              {action.label}
            </Button>
          </ToastPrimitive.Action>
        </div>
      )}
    </ToastPrimitive.Root>
  )
}
