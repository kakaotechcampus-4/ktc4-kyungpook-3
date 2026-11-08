import { useSearchParams } from 'react-router'
import { SIGNUP_PARAMS } from '@/shared/config/routes'
import { Button } from '@/shared/ui/button'
import { PagePlaceholder } from '@/shared/ui/page-placeholder'
import { MOCK_KAKAO_CHOICES, finishMockKakao } from './mockKakao'
import type { MockKakaoChoice } from './mockKakao'

export interface MockKakaoPageProps {
  /** 현재 탭 이동. 테스트가 바꿔 끼운다 */
  redirect?: (url: string) => void
}

const ACTIONS = 'flex flex-wrap gap-8'

const CHOICES = Object.entries(MOCK_KAKAO_CHOICES) as [
  keyof typeof MOCK_KAKAO_CHOICES,
  { label: string },
][]

function replaceLocation(url: string): void {
  window.location.replace(url)
}

/**
 * 개발·MSW 모드에서만 등록되는 모의 카카오 동의 화면 (#427). 실제 카카오 화면 자리다.
 * 기록은 replace 로 남긴다 — 뒤로가기로 이 화면에 다시 오지 않는다.
 */
export function MockKakaoPage({ redirect = replaceLocation }: MockKakaoPageProps) {
  const [searchParams] = useSearchParams()
  const finish = (choice: MockKakaoChoice) => {
    redirect(finishMockKakao(choice, searchParams.get(SIGNUP_PARAMS.next), window.sessionStorage))
  }

  return (
    <PagePlaceholder
      title="모의 카카오 로그인"
      description="개발용 MSW 화면이에요. 실제 카카오 동의 대신 결과를 골라 돌아가요."
    >
      <div className={ACTIONS}>
        {CHOICES.map(([choice, { label }]) => (
          <Button key={choice} variant="primary" onClick={() => finish(choice)}>
            {label}
          </Button>
        ))}
        <Button onClick={() => finish('cancelled')}>취소</Button>
        <Button variant="ghost" onClick={() => finish('failed')}>
          실패 재현
        </Button>
      </div>
    </PagePlaceholder>
  )
}
