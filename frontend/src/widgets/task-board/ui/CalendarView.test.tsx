import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { toTask } from '@/entities/task'
import { taskFixtures } from '@/shared/mock/fixtures/task'
import { toTaskResponse } from '@/shared/mock/task-state'
import { CalendarView } from './CalendarView'

/* 휴대폰 캘린더 (D-124, D-180). 폭 판정은 페이지가 하고 캘린더는 `compact` 만 받는다 */
function renderCalendar(compact: boolean) {
  return render(
    <MemoryRouter>
      <CalendarView
        workspaceId="ws_01"
        tasks={[toTask(toTaskResponse(taskFixtures[0]))]}
        approvals={[]}
        approvalsMissing={false}
        meetings={[]}
        names={new Map()}
        today="2026-09-18"
        month="2026-09"
        onMonthChange={() => {}}
        compact={compact}
      />
    </MemoryRouter>,
  )
}

describe('휴대폰 캘린더', () => {
  it('좁으면 달 표가 `캘린더 표` 가로 스크롤 영역 안에 있다', () => {
    renderCalendar(true)
    const region = screen.getByRole('region', { name: '캘린더 표' })
    expect(within(region).getByRole('table', { name: '2026년 9월' })).toBeVisible()
    expect(within(region).getByRole('link', { name: /로그인 API 연동/ })).toBeVisible()
  })

  it('넓으면 스크롤 영역 없이 표만 둔다', () => {
    renderCalendar(false)
    expect(screen.queryByRole('region', { name: '캘린더 표' })).toBeNull()
    expect(screen.getByRole('table', { name: '2026년 9월' })).toBeVisible()
  })
})
