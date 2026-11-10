import { useId, useRef, useState } from 'react'
import { Icon } from '@/shared/ui/icon'
import { CARD_WIDTH, SECTION_LEAD, SECTION_TITLE, TEXT_WIDTH } from './styles'

/* 카드 안 예시 블록은 정적 그림이라 누를 곳이 없다 — 캔버스의 버튼은 span 으로 옮겼다. */

const VALUES = [
  {
    id: 'meeting-summary',
    title: '회의를 올리면, 정리는 끝납니다',
    lead: '녹음을 올리면 발화자를 나누고 결정된 것과 담당자, 마감을 뽑아냅니다. 녹음이 없으면 텍스트 회의록을 붙여 넣어도 됩니다.',
  },
  {
    id: 'approvals',
    title: '확인이 필요한 것만 모아 드립니다',
    lead: '전부 다시 읽을 필요 없어요. 담당자가 둘로 갈렸거나 마감이 "다음 주쯤"으로만 나온 것만 승인 목록에 올라옵니다.',
  },
  {
    id: 'integrations',
    title: '승인한 것만 나갑니다',
    lead: '자동 발송은 기본값이 아닙니다. Notion 반영도 Discord DM도 확인한 뒤에 나가고, 반영 로그에서 언제든 되돌릴 수 있어요.',
  },
] as const

const VALUE = `${TEXT_WIDTH} flex scroll-mt-56 flex-col items-center gap-16 text-center`

export function ValueSections() {
  return (
    <div id="values" className="flex w-full flex-col items-center">
      {VALUES.map(({ id, title, lead }, index) => (
        <section
          id={id}
          key={id}
          className={`${VALUE} ${index === VALUES.length - 1 ? 'pb-[118px]' : 'pb-[60px]'}`}
        >
          <h2 className={SECTION_TITLE}>{title}</h2>
          <p className={`${SECTION_LEAD} max-w-[640px]`}>{lead}</p>
        </section>
      ))}
    </div>
  )
}

const FEATURE_CARD = 'flex flex-col gap-20 rounded-[24px] bg-surface-sunken p-28'

const FEATURE_TITLE = 'text-landing leading-[26px] font-semibold text-ink'

const FEATURE_TEXT = 'text-[14px] leading-[22px] text-dim'

const SAMPLE = 'flex min-h-[168px] flex-col gap-10 rounded-16 border border-line bg-surface p-16'

const SAMPLE_CAPTION = 'text-meta text-dim'

const SAMPLE_ROW = 'flex items-center justify-between gap-10 py-9'

function SampleRows({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return rows.map(([left, right], index) => (
    <div
      key={left}
      className={`${SAMPLE_ROW} ${index < rows.length - 1 ? 'border-b border-line' : ''}`}
    >
      <span className="text-[13px] text-ink">{left}</span>
      <span className="text-[12px] text-dim">{right}</span>
    </div>
  ))
}

function Candidate({ initial, name }: { initial: string; name: string }) {
  return (
    <span className="inline-flex h-34 items-center gap-7 rounded-999 border border-line bg-surface pr-14 pl-9 text-body text-ink">
      <span className="inline-flex h-20 w-20 shrink-0 items-center justify-center rounded-999 bg-surface-selected text-[10px] font-semibold text-ink">
        {initial}
      </span>
      {name}
    </span>
  )
}

const FEATURES = [
  {
    title: '회의록 정리',
    text: '녹음을 올리면 전사하고 발화자를 나눕니다. 요약에는 근거가 된 원문 구간이 함께 붙어 나와요.',
    sample: (
      <>
        <span className={SAMPLE_CAPTION}>전사문 · 3주차 정기회의</span>
        <SampleRows
          rows={[
            ['12:40 · 재환', 'API 명세서 9/17'],
            ['19:05 · 서연', '로그인 퍼블리싱 9/14'],
            ['31:05 · 도현', '발표 준비 — 담당자 미정'],
          ]}
        />
      </>
    ),
  },
  {
    title: '담당자 배치',
    text: '회의에서 정해진 사람을 그대로 붙입니다. 둘로 갈렸으면 고르라고 물어봐요.',
    sample: (
      <>
        <span className={SAMPLE_CAPTION}>발표 준비 · 후보 2명</span>
        <div className="flex items-center gap-8 pt-6">
          <Candidate initial="서" name="서연" />
          <Candidate initial="지" name="지민" />
        </div>
        <p className="mt-6 text-caption leading-[19px] text-dim">
          뒤이어 확답한 사람이 없어서 한 명으로 좁히지 못했어요.
        </p>
      </>
    ),
  },
  {
    title: '마감 리마인드',
    text: '마감 하루 전에 담당자에게 Discord DM이 갑니다. 문구는 보내기 전에 고칠 수 있어요.',
    sample: (
      <>
        <span className={SAMPLE_CAPTION}>Discord DM · 재환 · 09/16 09:00 예정</span>
        <p className="mt-4 rounded-16 bg-surface-selected px-14 py-11 text-[13px] leading-[20px] text-ink">
          재환님, API 명세서 마감이 다음 주 목요일이에요 🙂 막히는 부분 있으면 알려주세요.
        </p>
        <div className="mt-auto flex flex-row-reverse items-center justify-start gap-8">
          <span className="inline-flex h-32 items-center rounded-999 bg-ink-solid px-14 text-control font-semibold text-surface">
            이대로 발송
          </span>
          <span className="inline-flex h-32 items-center px-12 text-control font-semibold text-dim">
            고쳐 쓰기
          </span>
        </div>
      </>
    ),
  },
  {
    title: '되돌리기',
    text: '반영한 것은 전부 로그에 남습니다. 되돌릴 수 없는 건 DM 발송 하나뿐이에요.',
    sample: (
      <>
        <span className={SAMPLE_CAPTION}>반영 로그 · 오늘</span>
        <SampleRows
          rows={[
            ['API 명세서 — 자동 반영됨', '14:22'],
            ['로그인 퍼블리싱 — 승인함', '14:19'],
            ['마감일 3건 갱신 — 자동', '14:18'],
          ]}
        />
      </>
    ),
  },
] as const

export function FeatureCards() {
  return (
    <section
      id="features"
      aria-label="기능"
      className={`${CARD_WIDTH} grid scroll-mt-56 grid-cols-2 gap-24 pb-128`}
    >
      {FEATURES.map(({ title, text, sample }) => (
        <div key={title} className={FEATURE_CARD}>
          <div className="flex flex-col gap-10">
            <h3 className={FEATURE_TITLE}>{title}</h3>
            <p className={FEATURE_TEXT}>{text}</p>
          </div>
          {/* 예시 화면 조각. 읽을 내용은 제목과 설명에 이미 있다 */}
          <div aria-hidden="true" className={SAMPLE}>
            {sample}
          </div>
        </div>
      ))}
    </section>
  )
}

const TASKS = [
  {
    id: 'minutes',
    label: '회의록 정리',
    lines: [
      '녹음을 올리면 발화자를 나누고 회의 내용을 정리해요.',
      '요약과 결정사항을 확인하고, Notion에 반영할 수 있어요.',
    ],
  },
  {
    id: 'reminders',
    label: '마감 리마인드',
    lines: [
      '다가오는 마감과 담당자를 확인하고 알림을 준비해요.',
      'Discord로 보낼 문구를 고친 뒤, 확인하고 발송하세요.',
    ],
  },
  {
    id: 'assignment',
    label: '담당자 배치',
    lines: [
      '회의에서 정해진 업무에 담당자와 마감을 연결해요.',
      '담당자가 여럿이면 후보를 확인하고 직접 고를 수 있어요.',
    ],
  },
  {
    id: 'progress',
    label: '진행 상황 점검',
    lines: [
      '담당자에게 진행 상황을 물어보는 메시지를 준비해요.',
      '보낼 내용을 확인하고, 돌아온 답변을 대화에서 살펴보세요.',
    ],
  },
  {
    id: 'weekly',
    label: '주간 요약',
    lines: [
      '회의록과 태스크로 이번 주에 한 일과 남은 일을 살펴보세요.',
      '다음 회의에서 확인할 내용을 정리하는 데 활용할 수 있어요.',
    ],
  },
] as const

type Task = (typeof TASKS)[number]

const TASK_PILL =
  'inline-flex h-40 items-center rounded-999 border px-18 text-[15px] leading-none font-semibold'

export function Capabilities() {
  const prefix = useId()
  const [selected, setSelected] = useState<Task>(TASKS[0])
  const buttons = useRef(new Map<Task['id'], HTMLButtonElement>())

  return (
    <section
      aria-labelledby={`${prefix}-title`}
      className={`${TEXT_WIDTH} flex flex-col items-center gap-28 pb-128 text-center`}
    >
      <h2 id={`${prefix}-title`} className={SECTION_TITLE}>
        이런 일을 맡길 수 있어요
      </h2>
      <div
        role="tablist"
        aria-labelledby={`${prefix}-title`}
        className="flex flex-wrap items-center justify-center gap-10"
      >
        {TASKS.map((task, index) => (
          <button
            key={task.id}
            ref={(node) => {
              if (node === null) buttons.current.delete(task.id)
              else buttons.current.set(task.id, node)
            }}
            type="button"
            role="tab"
            id={`${prefix}-tab-${task.id}`}
            aria-selected={task.id === selected.id}
            aria-controls={`${prefix}-panel`}
            tabIndex={task.id === selected.id ? 0 : -1}
            className={`${TASK_PILL} ${
              task.id === selected.id
                ? 'border-transparent bg-ink-solid text-surface'
                : 'border-line bg-surface text-ink hover:bg-control'
            }`}
            onClick={() => setSelected(task)}
            onKeyDown={(event) => {
              const last = TASKS.length - 1
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % TASKS.length
                  : event.key === 'ArrowLeft'
                    ? (index + last) % TASKS.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? last
                        : null
              if (next === null) return
              event.preventDefault()
              setSelected(TASKS[next])
              buttons.current.get(TASKS[next].id)?.focus()
            }}
          >
            {task.label}
          </button>
        ))}
      </div>
      <p
        role="tabpanel"
        id={`${prefix}-panel`}
        aria-labelledby={`${prefix}-tab-${selected.id}`}
        tabIndex={0}
        className={`${SECTION_LEAD} min-h-[58px] max-w-[620px]`}
      >
        {selected.lines[0]}
        <br />
        {selected.lines[1]}
      </p>
      <a
        href="#features"
        className="inline-flex items-center gap-6 text-landing text-ink hover:text-sub"
      >
        기능 전부 보기
        <Icon name="chevron-right" size={15} />
      </a>
    </section>
  )
}
