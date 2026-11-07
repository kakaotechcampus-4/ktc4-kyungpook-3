import { Navigate, Outlet, useLocation } from 'react-router'
import { paths } from '@/shared/config/routes'
import { useEntryVisit } from './entryVisit'

/**
 * 랜딩 바깥 칸 (#510). 서비스를 써 본 브라우저가 바깥에서 `/` 로 들어오면 랜딩 대신 로그인으로 바꿔 보낸다.
 * 랜딩 화면 코드를 받기 전에 정한다 — 랜딩이 번쩍이지 않는다. 앱 안 링크(로그인 화면 로고 등)로 온 `/` 는 랜딩 그대로다.
 * 로그인한 사람은 바깥 칸(RedirectIfAuthed)이 먼저 워크스페이스로 보낸다. 검색 로봇은 기록이 없어 랜딩을 본다
 */
export function LandingEntry() {
  const { key } = useLocation()
  const entry = useEntryVisit()
  if (entry !== null && entry.returning && entry.key === key) {
    return <Navigate to={paths.login()} replace />
  }
  return <Outlet />
}
