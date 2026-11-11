import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'
import { Sheet } from '@/shared/ui/sheet'
import { ExternalLink } from './inline'
import { QUICK_GUIDE_STEPS, USER_GUIDE_URL } from './quickGuideSteps'

export const QUICK_GUIDE_TITLE = '처음 쓰는 분을 위한 안내'

const CALLOUT = 'rounded-10 bg-surface-selected px-14 py-10 text-body text-ink'
const STEP = 'flex gap-10'
const STEP_NUMBER =
  'mt-1 inline-flex size-22 shrink-0 items-center justify-center rounded-999 bg-ink-solid text-meta font-bold text-surface'
const STEP_TITLE = 'text-body font-bold text-ink'
const STEP_BODY = 'flex min-w-[0px] flex-1 flex-col gap-6 text-body text-sub'
const MEMBER = 'rounded-9 bg-surface-sunken px-10 py-6 text-caption text-sub'

function QuickGuideContent({ form }: { form: QuickGuideForm }) {
  return (
    <div className="flex flex-col gap-18">
      <p className={CALLOUT}>
        회의는 웹이 아니라 <strong>Discord 음성 채널</strong>에서 기록해요. 웹은 정리된 결과를 보고
        승인하는 곳이에요.
      </p>
      <ol className="flex flex-col gap-18">
        {QUICK_GUIDE_STEPS.map((step, index) => (
          <li key={step.title} className={STEP}>
            <span aria-hidden="true" className={STEP_NUMBER}>
              {index + 1}
            </span>
            <div className={STEP_BODY}>
              <h3 className={STEP_TITLE}>{step.title}</h3>
              {step.body}
              {step.member === null ? null : (
                <p className={MEMBER}>
                  <strong className="text-ink">팀원은:</strong> {step.member}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className={form === 'modal' ? 'text-right text-body text-sub' : 'text-body text-sub'}>
        <ExternalLink href={USER_GUIDE_URL}>
          자세히 보기 <span aria-hidden="true">→</span> 사용자 가이드
        </ExternalLink>
      </p>
    </div>
  )
}

/** 넓은 화면은 모달, 휴대폰 폭은 아래 시트 */
export type QuickGuideForm = 'modal' | 'sheet'

export interface QuickGuidePanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: QuickGuideForm
  /** 닫힌 뒤 포커스를 돌릴 요소. 연 단추를 준다 */
  returnFocus: () => HTMLElement | null
}

/** 본문만 스크롤하고 제목과 닫기는 늘 보인다 */
export function QuickGuidePanel({ open, onOpenChange, form, returnFocus }: QuickGuidePanelProps) {
  const close = (
    <Button variant="default" onClick={() => onOpenChange(false)}>
      닫기
    </Button>
  )

  if (form === 'sheet')
    return (
      // 열림을 단추가 쥐어 Radix Trigger 가 없다 — returnFocus 가 없으면 닫힌 뒤 포커스가 body 로 빠진다
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={QUICK_GUIDE_TITLE}
        returnFocus={returnFocus}
      >
        <div className="min-h-[0px] flex-1 overflow-y-auto pt-6 pb-12">
          <QuickGuideContent form={form} />
        </div>
        <div className="flex justify-end pt-6">{close}</div>
      </Sheet>
    )

  return (
    // 모달은 열 때 포커스가 있던 단추로 스스로 돌린다. 카드를 화면 높이에 묶고 본문만 스크롤한다
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={QUICK_GUIDE_TITLE}
      width={560}
      className="max-h-full"
      closeButton="absolute"
    >
      <div className="-mx-24 min-h-[0px] overflow-x-hidden overflow-y-auto px-24">
        <QuickGuideContent form={form} />
      </div>
    </Modal>
  )
}
