import { useState } from 'react'
import { Mascot } from '@/shared/ui/mascot'
import type { MascotPose } from '@/shared/ui/mascot'
import { CARD_WIDTH, SECTION_LEAD, SECTION_TITLE } from './styles'

const POSES: {
  key: string
  tab: string
  pose: MascotPose
  title: string
  text: string
  note: string
}[] = [
  {
    key: 'idle',
    tab: '대기',
    pose: 'idle',
    title: '회의를 기다립니다',
    text: '랜딩과 대시보드의 기본 포즈예요. 고개는 고정하고 2.5–4초에 한 번 깜빡입니다. 커서를 따라다니지 않아요 — 포즈는 제품의 상태로만 바뀝니다.',
    note: 'idle · 눈 두 개가 크기·높이·간격까지 완전 대칭',
  },
  {
    key: 'left',
    tab: '듣는 중',
    pose: 'left',
    title: '녹음을 듣고 정리합니다',
    text: '전사하고 발화자를 나누고, 결정된 것과 담당자와 마감을 골라냅니다. 확실한 건 묻지 않고 바로 Notion에 올려요.',
    note: 'left · 흰 얼굴을 왼쪽으로 밀어 오른쪽에 초승달',
  },
  {
    key: 'ask',
    tab: '묻는 중',
    pose: 'upRight',
    title: '확신하지 못한 것만 묻습니다',
    text: '담당자가 둘로 갈렸거나 마감이 "다음 주쯤"으로만 나온 것. 이런 것만 승인 목록에 올려 두고 기다립니다.',
    note: 'upRight · 고개는 그대로, 눈만 올려 기울임',
  },
  {
    key: 'done',
    tab: '완료',
    pose: 'squint',
    title: '확인이 끝나면 눈을 접습니다',
    text: '승인한 것만 Notion 보드에 반영되고 담당자에게 Discord DM이 나갑니다. 반영 로그에서 언제든 되돌릴 수 있어요.',
    note: 'squint · 세로 눈을 누른 게 아니라 가로 캡슐로 다시 그린 눈',
  },
]

const STAGE = 'relative flex h-[440px] items-center justify-center rounded-[24px] bg-surface-sunken'

/* 고른 칸은 선택 면 — 캔버스 .pose-tab 의 :checked 규칙 */
const TAB =
  'inline-flex h-40 items-center rounded-999 border px-18 text-[15px] font-semibold text-ink aria-pressed:border-transparent aria-pressed:bg-surface-selected border-line bg-surface hover:bg-control'

/** `일을 하는 건 매스입니다`. 포즈 칸을 누르면 그림과 설명이 함께 바뀐다 */
export function MascotShowcase() {
  const [selected, setSelected] = useState(POSES[0].key)
  const current = POSES.find(({ key }) => key === selected) ?? POSES[0]

  return (
    <section className={`${CARD_WIDTH} flex flex-col items-center gap-48 pb-128`}>
      <div className="flex flex-col items-center gap-16 text-center">
        <h2 className={SECTION_TITLE}>일을 하는 건 매스입니다</h2>
        <p className={`${SECTION_LEAD} max-w-[660px]`}>
          Manager&apos;s Manager 안에서 회의를 듣고 정리하는 도우미예요.
          <br />
          대화창은 없습니다 — 매스는 정리한 결과와 확인할 것만 화면에 올려 둡니다.
        </p>
      </div>
      <div className="grid w-full grid-cols-[560px_minmax(0,1fr)] items-center gap-64">
        <div className={STAGE}>
          <Mascot pose={current.pose} size={272} label={`매스 ${current.tab}`} />
          <span className="absolute bottom-20 left-24 text-meta text-dim tabular-nums">
            Manager&apos;s Manager
          </span>
        </div>
        <div className="flex flex-col gap-28">
          <div role="group" aria-label="매스 포즈" className="flex flex-wrap gap-8">
            {POSES.map(({ key, tab }) => (
              <button
                key={key}
                type="button"
                aria-pressed={key === selected}
                className={TAB}
                onClick={() => setSelected(key)}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-14" aria-live="polite">
            <h3 className="text-[24px] leading-[32px] font-semibold tracking-h3 text-ink">
              {current.title}
            </h3>
            <p className="max-w-[460px] text-landing leading-[26px] text-dim">{current.text}</p>
            <span className="pt-6 text-caption text-dim tabular-nums">{current.note}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
