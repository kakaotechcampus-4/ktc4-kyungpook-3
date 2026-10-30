import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '@/shared/config/routes'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { renderApp } from './test/renderApp'

/*
 * M8 메시지 (계획 C-6 1~6단계, AC-01 ~ AC-07). 개발 서버 + VITE_ENABLE_MSW=true 를 흉내낸다 — 이 파일 안에서만 설정을 바꾼다.
 * 실 API 모드의 준비 중 안내는 라우트·가드·앱 셸 테스트가 그대로 본다 (AC-01)
 */
vi.mock('@/shared/config/env', () => ({
  config: { apiBaseUrl: '/api/v1', mswEnabled: true },
}))

vi.setConfig({ testTimeout: 15_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

const list = () => within(screen.getByRole('complementary', { name: '메시지 목록' }))
const detail = () => within(screen.getByRole('region', { name: '메시지 내용' }))
const reviewList = () => list().getByRole('region', { name: /^보내기 전 확인/ })
const threadList = () => list().getByRole('region', { name: '대화' })
/** 행의 글자. 장식(aria-hidden 아바타 글자·답장 대기 점)은 빼고 읽는다 */
function rowTexts(region: HTMLElement): string[] {
  return within(region)
    .getAllByRole('link')
    .map((link) => {
      const copy = link.cloneNode(true) as HTMLElement
      copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove())
      return copy.textContent
    })
}
const current = () =>
  list()
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')

async function openInbox(path = paths.messages('ws_01')) {
  const app = renderApp(path)
  await screen.findByRole('region', { name: '대화' })
  return app
}

describe('MSW 모드에서만 새 화면이다 (AC-01)', () => {
  it.each([
    paths.messages('ws_01'),
    paths.messageThread('ws_01', 'th_01'),
    `${paths.messages('ws_01')}/nope`,
  ])('%s 는 준비 중 안내 대신 메시지 화면이다', async (path) => {
    renderApp(path)
    expect(await screen.findByRole('heading', { level: 1, name: '메시지' })).toBeInTheDocument()
    expect(screen.queryByText('메시지는 준비 중이에요')).toBeNull()
  })
})

describe('왼쪽 목록 두 영역과 오른쪽 상세의 2단이고, 선택은 URL 이 정한다 (AC-02)', () => {
  it('보내기 전 확인 2건과 대화 5건(사람별 4 + 채널 1)이 시안 순서로 보이고, 고르기 전에는 상세가 비어 있다', async () => {
    await openInbox()
    expect(within(reviewList()).getByRole('heading', { level: 2 })).toHaveTextContent(
      '보내기 전 확인 2',
    )
    expect(rowTexts(reviewList())).toEqual([
      '이재환09/17API 명세서 진행 상황을 물어보는 DM',
      '정하늘09/15퍼블리싱 진행 상황 확인',
    ])
    expect(rowTexts(threadList())).toEqual([
      '이재환나: DB 스키마가 확정됐다고 들었어요. 명세서 작업은 시작하셨나요?09/10답장 기다리는 중',
      '박민수STT 튜닝 결과 Notion에 붙였습니다09/09',
      '정하늘발표 순서 정리해서 올릴게요09/04',
      '박지훈확인했습니다09/02',
      '#회의록 요약나: 3주차 정기회의 요약 게시09/09',
    ])
    expect(current()).toEqual([])
    expect(
      detail().getByText('왼쪽 목록에서 확인할 메시지나 대화를 골라 주세요.'),
    ).toBeInTheDocument()
  })

  it('검토 항목을 고르면 주소의 review 가 바뀌고, 그 행만 현재 항목이며 읽기 전용 미리보기가 보인다', async () => {
    const app = await openInbox()
    await userEvent.click(within(reviewList()).getByRole('link', { name: /정하늘/ }))
    await app.expectSearch('?review=rv_02')
    expect(current()).toHaveLength(1)
    expect(current()[0]).toHaveTextContent('정하늘')
    expect(detail().getByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' })).toBeVisible()
    const preview = detail().getByRole('region', { name: '보낼 메시지 미리보기' })
    expect(preview).toHaveTextContent('Discord 개인 메시지 · 카테캠 3팀 봇')
    // 본문 이모지를 그대로 보인다
    expect(preview).toHaveTextContent(
      '하늘님, 퍼블리싱은 어디까지 진행됐는지 알려주실 수 있을까요? 🙏',
    )
    // 결정 전이라 행동 버튼이 없다
    expect(detail().queryByRole('button')).toBeNull()
  })

  it('주소로 바로 들어와도(새로고침) 같은 검토 항목이 골라져 있다', async () => {
    await openInbox(paths.messageReview('ws_01', 'rv_01'))
    expect(current()).toHaveLength(1)
    expect(current()[0]).toHaveTextContent('이재환')
    expect(detail().getByRole('region', { name: '보낼 메시지 미리보기' })).toHaveTextContent(
      '재환님, API 명세서 마감이 다음 주 목요일(9/24)이에요 🙂',
    )
  })

  it.each([
    ['목록에 없는 ID', 'rv_99'],
    ['ID 모양이 아닌 값', 'a/b'],
  ])('review 가 %s 이면 선택 없음이다 — 오류 화면이 아니다', async (_name, reviewId) => {
    await openInbox(`${paths.messages('ws_01')}?review=${encodeURIComponent(reviewId)}`)
    expect(current()).toEqual([])
    expect(
      detail().getByText('왼쪽 목록에서 확인할 메시지나 대화를 골라 주세요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('대화를 고르면 경로가 바뀌고 그 대화 행만 현재 항목이다 — 검토 항목은 현재 항목이 아니다', async () => {
    const app = await openInbox(paths.messageReview('ws_01', 'rv_01'))
    await userEvent.click(within(threadList()).getByRole('link', { name: /박민수/ }))
    await app.expectPath(paths.messageThread('ws_01', 'th_02'))
    await app.expectSearch('')
    await waitFor(() => expect(current()).toHaveLength(1))
    expect(current()[0]).toHaveTextContent('박민수')
    expect(
      within(reviewList())
        .getAllByRole('link')
        .every((link) => link.getAttribute('aria-current') !== 'page'),
    ).toBe(true)
  })
})
