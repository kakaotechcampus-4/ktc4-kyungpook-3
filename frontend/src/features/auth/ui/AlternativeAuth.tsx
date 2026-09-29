import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'

export interface AlternativeAuthProps {
  /** `Google 계정으로 로그인` · `Google 계정으로 가입하기` */
  googleLabel: string
}

const DIVIDER = 'self-center text-[13px] text-dim'

/**
 * `또는` 과 Google 버튼. Google OAuth 는 백엔드에 아직 없어서(계약 §4.1) **비활성으로만** 보인다 (D-007).
 * 누를 수 없고 포커스도 받지 않는다. 안내 문구·배지는 달지 않는다.
 */
export function AlternativeAuth({ googleLabel }: AlternativeAuthProps) {
  return (
    <>
      <span className={DIVIDER}>또는</span>
      <Button
        type="button"
        variant="outline"
        size="auth"
        disabled
        startIcon={<Icon name="globe" size={18} className="text-dim" />}
      >
        {googleLabel}
      </Button>
    </>
  )
}
