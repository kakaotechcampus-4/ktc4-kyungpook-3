import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * #523 — 팀 화면에서 팀원마다 별칭과 그 출처를 보고, PM 은 더하고 지운다. 잘못 배운 별칭은 지우는 것이 바로잡는 길이다.
 * 픽스처: 김서연 '서연'(직접)·'김서연'(이름), 이재환 '재한'(배움)·'이재환'·'재환'(이름), 정하늘 '하늘이'(디스코드, 미확인)·'정하늘'·'하늘'(이름)
 */

vi.setConfig({ testTimeout: 15_000 })

const TEAM = paths.members('ws_01')

/** 팀원 줄의 `별칭` 단추를 눌러 펼친다 */
async function openAliases(name: string) {
  const user = userEvent.setup()
  const row = within(await screen.findByRole('region', { name }))
  const toggle = await row.findByRole('button', { name: /^별칭 \d+$/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return { user, row, toggle }
}

/** 칩마다 `별칭 출처` 글자. 지우기 단추의 이름은 빼고 칩에 보이는 글자다 */
const chipTexts = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((item) => item.textContent)

const toastWith = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-toast-key]')).find((node) =>
    node.textContent?.includes(text),
  ) ?? null

describe('팀 화면 — 별칭 (PM)', () => {
  beforeEach(() => {
    applyScenario('settings-unmapped')
  })

  it('접혀 있다가 펼치면 칩마다 별칭과 출처가 보인다 — 확인 전인 Discord 닉네임은 미확인이다', async () => {
    renderApp(TEAM)
    const { row, toggle } = await openAliases('이재환')
    expect(toggle).toHaveTextContent('별칭 3')
    expect(chipTexts(row.getByRole('list', { name: '이재환의 별칭' }))).toEqual([
      '재한회의에서 배움',
      '이재환이름',
      '재환이름',
    ])

    const haneul = await openAliases('정하늘')
    expect(chipTexts(haneul.row.getByRole('list', { name: '정하늘의 별칭' }))).toContain(
      '하늘이디스코드 · 미확인',
    )
    const seoyeon = await openAliases('김서연')
    expect(chipTexts(seoyeon.row.getByRole('list', { name: '김서연의 별칭' }))).toContain(
      '서연직접 추가',
    )
    // 다시 누르면 접힌다
    await seoyeon.user.click(seoyeon.toggle)
    expect(seoyeon.row.queryByRole('list', { name: '김서연의 별칭' })).toBeNull()
  })

  it('별칭을 더하면 칩이 `직접 추가` 로 생기고 입력이 비워진다 — Enter 로도 보낸다', async () => {
    renderApp(TEAM)
    const { user, row, toggle } = await openAliases('이재환')
    const input = row.getByRole('textbox', { name: '이재환의 새 별칭' })
    const add = row.getByRole('button', { name: '추가' })
    expect(add).toBeDisabled()
    await user.type(input, '  재환   대리 ')
    await user.click(add)

    const list = row.getByRole('list', { name: '이재환의 별칭' })
    await waitFor(() => expect(chipTexts(list)).toContain('재환 대리직접 추가'))
    expect(input).toHaveValue('')
    expect(toggle).toHaveTextContent('별칭 4')
    expect(db.aliases).toContainEqual(
      expect.objectContaining({ member_id: 'mb_03', alias_text: '재환 대리', source: 'manual' }),
    )

    await user.type(input, '환이{Enter}')
    await waitFor(() => expect(chipTexts(list)).toContain('환이직접 추가'))
    expect(input).toHaveValue('')
  })

  it('이미 있는 별칭을 더하면 새 칩 없이 `이미 있는 별칭이에요.` 를 남긴다', async () => {
    renderApp(TEAM)
    const { user, row, toggle } = await openAliases('이재환')
    const input = row.getByRole('textbox', { name: '이재환의 새 별칭' })
    await user.type(input, '재한')
    await user.click(row.getByRole('button', { name: '추가' }))

    expect(await row.findByText('이미 있는 별칭이에요.')).toBeInTheDocument()
    expect(input).toHaveValue('재한')
    expect(toggle).toHaveTextContent('별칭 3')
    // 새로 적으면 지난 문구는 지금 값의 것이 아니다
    await user.type(input, '이')
    expect(row.queryByText('이미 있는 별칭이에요.')).toBeNull()
  })

  it('100자를 넘으면 보내지 않고 입력 아래에 알린다', async () => {
    renderApp(TEAM)
    const { user, row } = await openAliases('이재환')
    const input = row.getByRole('textbox', { name: '이재환의 새 별칭' })
    const log = recordRequests()
    await user.click(input)
    await user.paste('가'.repeat(101))
    await user.click(row.getByRole('button', { name: '추가' }))

    expect(input).toHaveAccessibleDescription('별칭은 1~100자로 적어 주세요.')
    expect(log.started.filter(({ method }) => method === 'POST')).toEqual([])
  })

  it('글자 수는 서버처럼 문자로 센다 — 이모지 51개는 보낸다', async () => {
    renderApp(TEAM)
    const { user, row } = await openAliases('이재환')
    const input = row.getByRole('textbox', { name: '이재환의 새 별칭' })
    const smiles = String.fromCodePoint(0x1f600).repeat(51)
    await user.click(input)
    await user.paste(smiles)
    await user.click(row.getByRole('button', { name: '추가' }))

    const list = row.getByRole('list', { name: '이재환의 별칭' })
    await waitFor(() => expect(chipTexts(list)).toContain(`${smiles}직접 추가`))
    expect(input).not.toHaveAccessibleDescription('별칭은 1~100자로 적어 주세요.')
  })

  it('보내는 동안 칸은 읽기 전용이라 그 사이 적은 글자를 성공 응답이 지우지 않는다', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    server.use(
      http.post('/api/v1/members/:memberId/aliases', async () => {
        await gate
      }),
    )
    renderApp(TEAM)
    const { user, row } = await openAliases('이재환')
    const input = row.getByRole('textbox', { name: '이재환의 새 별칭' })
    await user.type(input, 'first')
    await user.click(row.getByRole('button', { name: '추가' }))
    await user.type(input, 'second')
    expect(input).toHaveValue('first')

    release()
    const list = row.getByRole('list', { name: '이재환의 별칭' })
    await waitFor(() => expect(chipTexts(list)).toContain('first직접 추가'))
    expect(input).toHaveValue('')
    await user.type(input, 'third')
    expect(input).toHaveValue('third')
  })

  it('지우면 포커스가 옆 지우기 단추로, 마지막 별칭이면 새 별칭 칸으로 간다', async () => {
    renderApp(TEAM)
    const { user, row } = await openAliases('이재환')
    const list = () => row.getByRole('list', { name: '이재환의 별칭' })
    // 칩 순서: 재한, 이재환, 재환
    row.getByRole('button', { name: "'재한' 별칭 지우기" }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(chipTexts(list())).toEqual(['이재환이름', '재환이름']))
    await waitFor(() =>
      expect(row.getByRole('button', { name: "'이재환' 별칭 지우기" })).toHaveFocus(),
    )

    row.getByRole('button', { name: "'재환' 별칭 지우기" }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(chipTexts(list())).toEqual(['이재환이름']))
    await waitFor(() =>
      expect(row.getByRole('button', { name: "'이재환' 별칭 지우기" })).toHaveFocus(),
    )

    await user.keyboard('{Enter}')
    await waitFor(() => expect(row.getByText('등록된 별칭이 없어요.')).toBeVisible())
    await waitFor(() =>
      expect(row.getByRole('textbox', { name: '이재환의 새 별칭' })).toHaveFocus(),
    )
  })

  it('잘못 배운 별칭을 지우면 칩이 사라지고 알림이 뜬다', async () => {
    renderApp(TEAM)
    const { user, row, toggle } = await openAliases('이재환')
    await user.click(row.getByRole('button', { name: "'재한' 별칭 지우기" }))

    await waitFor(() =>
      expect(chipTexts(row.getByRole('list', { name: '이재환의 별칭' }))).toEqual([
        '이재환이름',
        '재환이름',
      ]),
    )
    expect(toggle).toHaveTextContent('별칭 2')
    expect(toastWith("'재한' 별칭을 지웠어요")).not.toBeNull()
    expect(db.aliases.some(({ alias_id }) => alias_id === 'al_10')).toBe(false)
  })

  it('다른 곳에서 이미 지운 별칭이면 그렇다고 알리고 목록을 새로 받는다', async () => {
    renderApp(TEAM)
    const { user, row } = await openAliases('이재환')
    db.aliases = db.aliases.filter(({ alias_id }) => alias_id !== 'al_10')
    await user.click(row.getByRole('button', { name: "'재한' 별칭 지우기" }))

    await waitFor(() => expect(toastWith('이미 지워진 별칭이에요.')).not.toBeNull())
    await waitFor(() =>
      expect(row.queryByRole('button', { name: "'재한' 별칭 지우기" })).toBeNull(),
    )
  })
})

describe('팀 화면 — 별칭 (일반 팀원)', () => {
  beforeEach(() => {
    applyScenario('settings-member')
  })

  it('별칭과 출처는 보지만 더하는 칸과 지우기 단추가 없다', async () => {
    renderApp(TEAM)
    const { row } = await openAliases('이재환')
    expect(chipTexts(row.getByRole('list', { name: '이재환의 별칭' }))).toEqual([
      '재한회의에서 배움',
      '이재환이름',
      '재환이름',
    ])
    expect(row.queryByRole('textbox')).toBeNull()
    expect(row.queryByRole('button', { name: /별칭 지우기|^추가$/ })).toBeNull()
  })
})
