import { useParams, useSearchParams } from 'react-router'
import type { OAuthOutcome } from '@/shared/lib/oauth'
import { parseEnumParam, parseRouteId } from '@/shared/lib/url'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { PagePlaceholder } from '@/shared/ui/page-placeholder'
import { MOCK_OAUTH_PROVIDERS, finishMockOAuth, mockOAuthProviderName } from './mockOAuth'

export interface MockOAuthPageProps {
  /** 현재 탭 이동. 테스트가 바꿔 끼운다 */
  redirect?: (url: string) => void
}

const ACTIONS = 'flex flex-wrap gap-8'

const NOTE = 'text-body text-sub'

function replaceLocation(url: string): void {
  window.location.replace(url)
}

/**
 * 개발·MSW 모드에서만 등록되는 모의 OAuth 화면. 실제 Discord·Notion 인증 화면 자리다.
 * 성공·취소·실패를 골라 `state` 의 온보딩 단계로 현재 탭을 옮긴다 (D-158).
 * 기록은 replace 로 남긴다 — 뒤로가기로 이 화면에 다시 오지 않는다.
 */
export function MockOAuthPage({ redirect = replaceLocation }: MockOAuthPageProps) {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const workspaceId = parseRouteId(params.workspaceId)
  const provider = parseEnumParam(params.provider, MOCK_OAUTH_PROVIDERS)

  if (workspaceId === null || provider === null) {
    return <PagePlaceholder title="모의 OAuth 주소가 올바르지 않아요" />
  }

  const name = mockOAuthProviderName(provider)
  const finish = (outcome: OAuthOutcome) => {
    redirect(
      finishMockOAuth(
        { workspaceId, provider, state: searchParams.get('state'), outcome },
        window.sessionStorage,
      ),
    )
  }

  return (
    <PagePlaceholder
      title={`모의 ${name} 연결`}
      description="개발용 MSW 화면이에요. 실제 인증 대신 결과를 골라 원래 단계로 돌아가요."
    >
      <Card>
        <p className={NOTE}>워크스페이스 {workspaceId}</p>
      </Card>
      <div className={ACTIONS}>
        <Button variant="primary" onClick={() => finish('success')}>
          연결 허용
        </Button>
        <Button onClick={() => finish('cancelled')}>취소</Button>
        <Button variant="ghost" onClick={() => finish('failed')}>
          실패 재현
        </Button>
      </div>
    </PagePlaceholder>
  )
}
