import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export interface ErrorTextProps extends ComponentPropsWithoutRef<'p'> {
  /** 문구는 호출자가 준다 */
  children: ReactNode
}

/**
 * 필드 오류 한 줄. 입력 **아래**에 놓고, 입력의 `aria-describedby` 가 이걸 가리킨다 (D-142).
 *
 * 실측 근거가 없는 제안 값이다 — 캔버스 25장에 오류 메시지 텍스트가 한 줄도 없다.
 * 라벨과 같은 단(12/400)에 경계·라벨과 같은 강조색을 쓴다.
 *
 * **아이콘을 붙이지 않는다.** 유채 정보/성공/경고/오류 박스를 쓰지 않는다 (design-system.md §7-13).
 * 비필드 서버 오류는 폼 상단의 별도 블록이다 — 이 컴포넌트가 아니다.
 */
export function ErrorText({ className, children, ...rest }: ErrorTextProps) {
  const classes = ['text-[12px] font-normal text-accent', className].filter(Boolean).join(' ')

  return (
    <p role="alert" className={classes} {...rest}>
      {children}
    </p>
  )
}
