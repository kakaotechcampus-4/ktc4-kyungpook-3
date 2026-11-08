import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import { Sheet } from './Sheet'

function Demo() {
  const [open, setOpen] = useState(false)
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="담당자"
      trigger={<button type="button">담당자 열기</button>}
    >
      <button type="button">안의 단추</button>
    </Sheet>
  )
}

async function openSheet() {
  const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
  render(<Demo />)
  const trigger = screen.getByRole('button', { name: '담당자 열기' })
  await user.click(trigger)
  const sheet = await screen.findByRole('dialog', { name: '담당자' })
  return { user, trigger, sheet }
}

/** 손잡이·제목 자리를 dy 만큼 끌어 내렸다 놓는다 */
function drag(sheet: HTMLElement, dy: number) {
  const grip = screen.getByText('담당자', { selector: 'h2' }).parentElement
  if (grip === null) throw new Error('끄는 자리가 없다')
  fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientY: 400 })
  fireEvent.pointerMove(grip, { pointerId: 1, clientY: 400 + dy })
  expect(sheet.style.transform).toBe(`translateY(${String(dy)}px)`)
  fireEvent.pointerUp(grip, { pointerId: 1, clientY: 400 + dy })
}

describe('Sheet', () => {
  it('칸 이름이 제목인 대화상자로 열리고 포커스가 안으로 간다', async () => {
    const { sheet } = await openSheet()
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true))
  })

  it('Esc 로 닫으면 트리거로 포커스가 돌아온다', async () => {
    const { user, trigger } = await openSheet()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('바깥을 누르면 닫힌다', async () => {
    const { user } = await openSheet()
    await user.click(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('손잡이를 80px 넘게 끌어 내리면 닫힌다', async () => {
    const { sheet } = await openSheet()
    drag(sheet, 120)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('조금 끌다 놓으면 제자리로 돌아오고 열린 채다', async () => {
    const { sheet } = await openSheet()
    drag(sheet, 40)
    expect(sheet.style.transform).toBe('')
    expect(screen.getByRole('dialog', { name: '담당자' })).toBeInTheDocument()
  })
})
