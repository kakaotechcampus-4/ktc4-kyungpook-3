import { Button } from '@/shared/ui/button'
import { useStartKakao } from '../model/useStartKakao'

export interface AlternativeAuthProps {
  /** `카카오로 로그인` · `카카오로 가입하기` */
  label: string
}

const DIVIDER = 'self-center text-[13px] text-dim'

/** `또는` 과 카카오 버튼. 누르면 현재 탭이 카카오로 간다 (D-179) */
export function AlternativeAuth({ label }: AlternativeAuthProps) {
  const startKakao = useStartKakao()
  return (
    <>
      <span className={DIVIDER}>또는</span>
      <Button type="button" variant="outline" size="auth" onClick={startKakao}>
        {label}
      </Button>
    </>
  )
}
