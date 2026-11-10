import { useId, useRef, useState } from 'react'
import { Icon } from '@/shared/ui/icon'
import { CARD_WIDTH, SECTION_LEAD, SECTION_TITLE, TEXT_WIDTH } from './styles'

const WORKFLOW_STEPS = [
  '녹음 올리고 화자 지정',
  '전사문 확인하고 수정',
  '업무 승인하고 요약 확인',
  '태스크와 답장으로 후속 확인',
] as const

export function ValueSections() {
  return (
    <section
      id="values"
      aria-label="회의 이후의 흐름"
      className={`${CARD_WIDTH} mb-64 scroll-mt-56 border-y border-line py-24 sm:mb-96`}
    >
      <p className="mb-24 text-[16px] font-semibold text-ink">회의 이후의 일을 이어 줍니다.</p>
      <ol className="grid grid-cols-2 gap-x-18 gap-y-24 lg:grid-cols-4 lg:gap-28">
        {WORKFLOW_STEPS.map((step, index) => (
          <li
            key={step}
            className="flex items-start gap-10 border-t-2 border-line pt-12 text-[12px] leading-[20px] text-ink sm:text-[14px]"
          >
            <span className="font-semibold text-accent">0{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

const FEATURES = [
  {
    title: '회의록은 팀이 확인한 내용으로.',
    text: '녹음을 올리고 화자를 지정하세요. 제목과 전사문을 직접 고치고, 확인할 항목을 승인한 뒤 회의 요약을 읽을 수 있어요.',
  },
  {
    title: '프로젝트를 여러 관점으로.',
    text: '태스크는 리스트·보드·캘린더·간트로 살펴보세요. 프로젝트 맵에서는 주제와 태스크의 연결을 보고, 주제와 결정 내용을 다듬을 수 있어요.',
  },
  {
    title: '진행 상황은 대화로 이어서.',
    text: '담당자에게 물어볼 메시지를 준비하고 문구와 발송 시각을 정하세요. 웹에서 답장을 주고받으며 달라진 업무 내용을 확인할 수 있어요.',
  },
] as const

export function FeatureCards() {
  return (
    <section
      id="features"
      aria-label="기능"
      className={`${CARD_WIDTH} mb-64 grid scroll-mt-56 gap-36 lg:mb-96 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-96`}
    >
      <div>
        <h2 className={SECTION_TITLE}>
          기록으로 남기고,
          <br />
          일의 흐름을 이어 가세요.
        </h2>
        <p className={`${SECTION_LEAD} mt-22 max-w-[440px]`}>
          정리된 회의록만으로는 일이 끝나지 않으니까요. 원문을 바로잡는 순간부터 다음 회의를 준비할
          때까지 함께합니다.
        </p>
        <div className="mt-32 rounded-r-12 border-l-[3px] border-accent-solid bg-surface-sunken px-24 py-24">
          <h3 className="text-[16px] font-semibold text-ink">필요한 기록은 파일로 가져가세요.</h3>
          <p className="mt-6 text-[14px] leading-[24px] text-dim">
            회의 요약과 기간별 프로젝트 기록을 Markdown으로 내려받아 공유할 수 있어요.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-26">
        {FEATURES.map(({ title, text }) => (
          <article key={title} className="border-b border-line pb-26">
            <h3 className="text-[22px] leading-[30px] font-semibold tracking-h3 text-ink sm:text-[24px]">
              {title}
            </h3>
            <p className="mt-9 text-[15px] leading-[27px] text-dim">{text}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

const INTEGRATIONS = [
  {
    name: 'Notion',
    text: '회의에서 정한 태스크를 팀의 Notion에 반영하세요. 연결 상태와 반영 결과를 웹에서 확인할 수 있어요.',
    note: '회의 요약은 웹에서 읽거나 Markdown 파일로 가져가세요.',
  },
  {
    name: 'Discord',
    text: 'Discord로 새 메시지를 알리고 답장은 웹 대화에서 확인하세요. 재촉의 문구·발송 시각·자동 승인 여부도 설정할 수 있어요.',
    note: '팀원과 나눈 대화는 태스크와 함께 웹에서 이어서 살펴보세요.',
  },
] as const

export function Integrations() {
  return (
    <section
      aria-label="연동"
      className={`${CARD_WIDTH} mb-64 rounded-[24px] bg-ink-solid px-24 py-40 sm:px-40 sm:py-48 lg:mb-96 lg:px-64 lg:py-64`}
    >
      <div id="integrations" className="scroll-mt-56">
        <div className="flex flex-col justify-between gap-24 lg:flex-row lg:gap-48">
          <h2 className="max-w-[520px] text-[30px] leading-[1.3] font-semibold tracking-h3 text-surface sm:text-[36px]">
            팀이 쓰는 도구와,
            <br />
            필요한 만큼 연결하세요.
          </h2>
          <p className="max-w-[360px] text-[15px] leading-[27px] text-surface/80">
            회의록과 태스크는 웹에서 먼저 사용할 수 있어요. 연동을 연결하면 업무 반영과 팀원 알림을
            함께 이어 갈 수 있습니다.
          </p>
        </div>
        <div className="mt-36 grid gap-32 sm:grid-cols-2 sm:gap-40">
          {INTEGRATIONS.map(({ name, text, note }) => (
            <article key={name} className="border-t-2 border-surface/20 pt-24">
              <h3 className="text-[26px] font-semibold text-surface">{name}</h3>
              <p className="mt-12 text-[15px] leading-[27px] text-surface/90">{text}</p>
              <p className="mt-16 text-[12px] leading-[21px] text-surface/70">{note}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

const TASKS = [
  {
    id: 'minutes',
    label: '회의록 정리',
    lines: [
      '녹음의 화자를 지정하고, 제목과 전사문을 직접 다듬으세요.',
      '확인할 항목을 승인한 뒤 정리된 회의 요약을 읽을 수 있어요.',
    ],
  },
  {
    id: 'reminders',
    label: '마감 리마인드',
    lines: [
      '다가오는 마감과 담당자를 확인하고 재촉을 준비하세요.',
      '보낼 문구와 시각을 고치고 자동 승인 여부를 설정할 수 있어요.',
    ],
  },
  {
    id: 'assignment',
    label: '담당자 배치',
    lines: [
      '회의에서 정해진 업무에 담당자와 마감을 연결하세요.',
      '후보가 여럿이면 확인할 항목에서 담당자를 직접 골라 주세요.',
    ],
  },
  {
    id: 'progress',
    label: '진행 상황 점검',
    lines: [
      '대시보드에서 마감 임박과 막힌 일을 먼저 살펴보세요.',
      '웹 메시지와 답장으로 담당자에게 진행 상황을 물어볼 수 있어요.',
    ],
  },
  {
    id: 'weekly',
    label: '주간 요약',
    lines: [
      '회의록과 태스크로 이번 주에 한 일과 남은 일을 돌아보세요.',
      '기간별 프로젝트 기록을 Markdown으로 가져갈 수 있어요.',
    ],
  },
] as const

type Task = (typeof TASKS)[number]

const TASK_PILL =
  'inline-flex min-h-40 items-center justify-center rounded-999 border px-18 text-[14px] leading-[20px] font-semibold sm:text-[15px]'

export function Capabilities() {
  const prefix = useId()
  const [selected, setSelected] = useState<Task>(TASKS[0])
  const buttons = useRef(new Map<Task['id'], HTMLButtonElement>())

  return (
    <section
      aria-labelledby={`${prefix}-title`}
      className={`${TEXT_WIDTH} flex flex-col items-center gap-28 pb-64 text-center sm:pb-96`}
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
            className={`${TASK_PILL} ${task.id === selected.id ? 'border-transparent bg-ink-solid text-surface' : 'border-line bg-surface text-ink hover:bg-control'}`}
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
        className={`${SECTION_LEAD} min-h-[112px] max-w-[620px] sm:min-h-[58px]`}
      >
        {selected.lines[0]}
        <br />
        {selected.lines[1]}
      </p>
      <a
        href="#features"
        className="inline-flex items-center gap-6 text-[15px] font-semibold text-ink hover:text-accent"
      >
        기능 전부 보기
        <Icon name="chevron-right" size={15} />
      </a>
    </section>
  )
}
