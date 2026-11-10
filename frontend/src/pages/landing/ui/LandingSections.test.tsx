import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Capabilities } from './LandingSections'

const TASK_DESCRIPTIONS = [
  ['회의록 정리', '녹음을 올리면 발화자를 나누고 회의 내용을 정리해요.'],
  ['마감 리마인드', '다가오는 마감과 담당자를 확인하고 알림을 준비해요.'],
  ['담당자 배치', '회의에서 정해진 업무에 담당자와 마감을 연결해요.'],
  ['진행 상황 점검', '담당자에게 진행 상황을 물어보는 메시지를 준비해요.'],
  ['주간 요약', '회의록과 태스크로 이번 주에 한 일과 남은 일을 살펴보세요.'],
]

describe('랜딩에서 맡길 수 있는 일', () => {
  it('처음에는 회의록 정리 탭과 연결된 설명을 보여 준다', () => {
    render(<Capabilities />)
    expect(screen.getByRole('tablist', { name: '이런 일을 맡길 수 있어요' })).toBeInTheDocument()
    const selected = screen.getByRole('tab', { name: '회의록 정리' })
    const panel = screen.getByRole('tabpanel', { name: '회의록 정리' })
    expect(selected).toHaveAttribute('aria-selected', 'true')
    expect(selected).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveTextContent('녹음을 올리면 발화자를 나누고 회의 내용을 정리해요.')
  })

  it('다섯 업무를 선택하면 선택 표시와 설명이 함께 바뀐다', async () => {
    const user = userEvent.setup()
    render(<Capabilities />)
    for (const [label, description] of TASK_DESCRIPTIONS) {
      await user.click(screen.getByRole('tab', { name: label }))
      const panel = screen.getByRole('tabpanel', { name: label })
      expect(panel).toHaveTextContent(description)
      expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1)
      expect(screen.getByRole('tab', { name: label })).toHaveAttribute('tabindex', '0')
      expect(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toHaveLength(1)
    }
  })

  it('방향키를 순환하고 Home·End로 옮긴 뒤 Tab으로 설명을 읽는다', async () => {
    const user = userEvent.setup()
    render(<Capabilities />)
    await user.tab()
    expect(screen.getByRole('tab', { name: '회의록 정리' })).toHaveFocus()
    await user.keyboard('[ArrowLeft]')
    expect(screen.getByRole('tab', { name: '주간 요약', selected: true })).toHaveFocus()
    await user.keyboard('[ArrowRight]')
    expect(screen.getByRole('tab', { name: '회의록 정리', selected: true })).toHaveFocus()
    await user.keyboard('[End]')
    expect(screen.getByRole('tab', { name: '주간 요약', selected: true })).toHaveFocus()
    await user.keyboard('[Home][ArrowRight]')
    expect(screen.getByRole('tab', { name: '마감 리마인드', selected: true })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('tabpanel', { name: '마감 리마인드' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: '기능 전부 보기' })).toHaveFocus()
  })
})
