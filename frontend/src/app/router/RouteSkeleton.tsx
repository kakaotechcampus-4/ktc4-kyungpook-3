import { useLocation } from 'react-router'
import { OnboardingSkeleton, PageSkeleton } from '@/shared/ui/page-skeleton'

/**
 * 화면 코드·가드 캐시를 기다리는 동안의 자리. 온보딩은 가운데 열 틀이라 그 모양의 뼈대를 쓴다 —
 * 제품 화면 뼈대(왼쪽 위)를 쓰면 온보딩이 그려질 때 내용이 크게 튄다
 */
export function RouteSkeleton() {
  const { pathname } = useLocation()
  return pathname.startsWith('/onboarding/') ? <OnboardingSkeleton /> : <PageSkeleton />
}
