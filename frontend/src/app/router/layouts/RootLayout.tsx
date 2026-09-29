import { Outlet } from 'react-router'
import { UnsavedChangesPrompt } from '../UnsavedChangesPrompt'

/** 앱 전체의 바깥 칸. 이탈 확인 모달은 여기 하나만 둔다 */
export function RootLayout() {
  return (
    <>
      <Outlet />
      <UnsavedChangesPrompt />
    </>
  )
}
