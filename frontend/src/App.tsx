/* M2 확인용 임시 갤러리다. 제품 화면이 아니다.
   M3에서 라우터를 넣을 때 지운다.

   shared/ui 를 눈으로 한 번에 보려고 만든 자리라서 여기 문구는 전부 갤러리 라벨이다.
   제품 카피가 아니므로 이 파일의 문자열을 다른 화면으로 가져가지 않는다. */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/button/Button'
import type { ButtonSize, ButtonVariant } from '@/shared/ui/button/Button'
import { Label } from '@/shared/ui/label/Label'
import { ErrorText } from '@/shared/ui/error-text/ErrorText'
import { TextField } from '@/shared/ui/text-field/TextField'
import { Card } from '@/shared/ui/card/Card'
import type { CardVariant } from '@/shared/ui/card/Card'
import { Panel } from '@/shared/ui/panel/Panel'
import { Skeleton } from '@/shared/ui/skeleton/Skeleton'
import { Checkbox } from '@/shared/ui/checkbox/Checkbox'
import type { CheckboxState } from '@/shared/ui/checkbox/Checkbox'
import { SelectCard, SelectCardGroup } from '@/shared/ui/select-card/SelectCard'
import { Segmented, SegmentedItem } from '@/shared/ui/segmented/Segmented'
import { Modal } from '@/shared/ui/modal/Modal'
import { Toast, ToastProvider, ToastViewport } from '@/shared/ui/toast/Toast'
import { EmptyState } from '@/shared/ui/empty-state/EmptyState'
import { Mascot } from '@/shared/ui/mascot/Mascot'
import type { MascotPose } from '@/shared/ui/mascot/Mascot'

/* 표는 모듈 스코프에 둔다 — 렌더마다 다시 만들지 않는다. */

const PAGE = 'mx-auto flex max-w-column flex-col gap-48 px-24 py-48'

/* 갤러리 제목도 EmptyState 와 같은 단이다 — 줄 높이·자간의 `!` 는 오타가 아니다.
   docs/error/2026-09-16-unlayered-global-beats-utilities.md */
const PAGE_TITLE = 'text-[24px] leading-[1.35] font-bold tracking-[-0.035em] text-ink'

const SECTION = 'flex flex-col gap-14'

const SECTION_TITLE = 'text-caption font-semibold text-faint'

const ROW = 'flex flex-wrap items-center gap-12'

/* 폭 토큰을 쓰지 않는다 — `max-w-prose` 는 `--container-prose` 가 아니라 Tailwind 기본 65ch 다.
   docs/error/2026-09-16-max-w-prose-is-not-the-token.md */
const COLUMN = 'flex max-w-[420px] flex-col gap-12'

const BUTTON_VARIANTS: ButtonVariant[] = ['primary', 'default', 'ghost', 'text', 'outline']

const BUTTON_SIZES: ButtonSize[] = [
  'sm',
  'md',
  'md-compact',
  'lg',
  'lg-onboarding',
  'xl',
  'landing-hero',
  'landing-nav',
]

const CARD_VARIANTS: CardVariant[] = ['default', 'attention', 'pending', 'onboarding']

const CHECKBOX_STATES: CheckboxState[] = [false, true, 'indeterminate']

const MASCOT_POSES: MascotPose[] = [
  'idle',
  'left',
  'right',
  'squint',
  'upLeft',
  'upRight',
  'talking',
  'dial',
]

interface SectionProps {
  title: string
  children: ReactNode
}

/** 갤러리 한 칸. 제목은 갤러리 라벨이라 h2 다 — 이 화면의 h1 은 페이지 제목 하나뿐이다 */
function Section({ title, children }: SectionProps) {
  return (
    <section className={SECTION}>
      <h2 className={SECTION_TITLE}>{title}</h2>
      {children}
    </section>
  )
}

/** 세그먼트는 제어 컴포넌트로만 쓴다 — 갤러리도 상태를 들고 있어야 한다 */
function SegmentedDemo() {
  const [small, setSmall] = useState('all')
  const [medium, setMedium] = useState('mail')

  return (
    <div className={ROW}>
      <Segmented value={small} onValueChange={setSmall} aria-label="segmented sm">
        <SegmentedItem value="all">all</SegmentedItem>
        <SegmentedItem value="todo">todo</SegmentedItem>
        <SegmentedItem value="done">done</SegmentedItem>
        <SegmentedItem value="off" disabled>
          disabled
        </SegmentedItem>
      </Segmented>

      <Segmented value={medium} onValueChange={setMedium} size="md" aria-label="segmented md">
        <SegmentedItem value="mail">mail</SegmentedItem>
        <SegmentedItem value="file">file</SegmentedItem>
      </Segmented>
    </div>
  )
}

function SelectCardDemo() {
  const [value, setValue] = useState('auto')

  return (
    <SelectCardGroup value={value} onValueChange={setValue} aria-label="select card">
      <SelectCard value="auto" title="selected" description="description line" />
      <SelectCard value="manual" title="unselected" description="description line" />
      <SelectCard value="off" title="disabled" description="description line" disabled />
    </SelectCardGroup>
  )
}

interface CheckboxDemoProps {
  initial: CheckboxState
  invalid?: boolean
  disabled?: boolean
  children: string
}

function CheckboxDemo({ initial, invalid, disabled, children }: CheckboxDemoProps) {
  const [checked, setChecked] = useState<CheckboxState>(initial)

  return (
    <Checkbox
      checked={checked}
      onCheckedChange={setChecked}
      invalid={invalid}
      disabled={disabled}
      className="w-[180px]"
    >
      {children}
    </Checkbox>
  )
}

/** 열림 상태는 호출자가 소유한다 — 갤러리가 그 호출자다 */
function ModalDemo() {
  const [open, setOpen] = useState(false)

  return (
    <div className={ROW}>
      <Button onClick={() => setOpen(true)}>open modal</Button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="modal title"
        description="modal description"
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              cancel
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              confirm
            </Button>
          </>
        }
      >
        <Panel>
          <span className="text-caption text-dim">modal body slot</span>
        </Panel>
      </Modal>
    </div>
  )
}

/* Provider 는 갤러리의 토스트 데모만 감싼다.
   앱 전체 배선(app/providers)은 M3 몫이라 여기서 만들지 않는다 — §7-9. */
function ToastDemo() {
  const [plain, setPlain] = useState(false)
  const [withAction, setWithAction] = useState(false)

  return (
    <ToastProvider>
      <div className={ROW}>
        <Button onClick={() => setPlain(true)}>toast</Button>
        <Button onClick={() => setWithAction(true)}>toast with action</Button>
      </div>

      <Toast open={plain} onOpenChange={setPlain} title="toast title" description="description" />

      <Toast
        open={withAction}
        onOpenChange={setWithAction}
        title="toast title"
        description="description"
        action={{ label: 'undo', onClick: () => setWithAction(false) }}
      />

      <ToastViewport />
    </ToastProvider>
  )
}

function App() {
  return (
    <main className={PAGE}>
      <h1 className={PAGE_TITLE}>M2 gallery</h1>

      <Section title="Button — variant">
        <div className={ROW}>
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
          <Button variant="primary" disabled>
            disabled
          </Button>
          <Button variant="primary" loading>
            loading
          </Button>
        </div>
      </Section>

      <Section title="Button — size">
        <div className={ROW}>
          {BUTTON_SIZES.map((size) => (
            <Button key={size} size={size}>
              {size}
            </Button>
          ))}
        </div>
        <div className={COLUMN}>
          <Button size="auth" variant="primary">
            auth
          </Button>
        </div>
      </Section>

      <Section title="Label · ErrorText">
        <div className={COLUMN}>
          <Label tone="product">product</Label>
          <Label tone="onboarding">onboarding</Label>
          <Label tone="auth">auth</Label>
          <Label blocking>blocking</Label>
          <ErrorText>error text</ErrorText>
        </div>
      </Section>

      <Section title="TextField">
        <div className={COLUMN}>
          <TextField label="product" placeholder="placeholder" description="description" />
          <TextField tone="onboarding" label="onboarding" placeholder="placeholder" />
          <TextField tone="auth" label="auth" placeholder="placeholder" />
          <TextField
            label="required blocking"
            labelTone="required-blocking"
            placeholder="placeholder"
          />
          <TextField label="error" placeholder="placeholder" error="error message" />
          <TextField label="disabled" placeholder="placeholder" disabled />
          <TextField
            label="adornments"
            placeholder="placeholder"
            startAdornment={<span className="text-caption text-faint">@</span>}
            endAdornment={
              <Button variant="text" size="md-compact">
                show
              </Button>
            }
          />
        </div>
      </Section>

      <Section title="Card">
        <div className={COLUMN}>
          {CARD_VARIANTS.map((variant) => (
            <Card key={variant} variant={variant}>
              <span className="text-body text-ink">{variant}</span>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Panel">
        <div className={COLUMN}>
          <Panel>
            <span className="mono text-meta text-faint">source line</span>
            <span className="text-body text-ink">quoted line</span>
            <span className="text-caption text-dim">supporting line</span>
          </Panel>
        </div>
      </Section>

      <Section title="Skeleton">
        <div className={COLUMN} aria-busy="true">
          <Skeleton />
          <Skeleton lines={3} />
          <Skeleton variant="block" height={72} />
          <Skeleton variant="circle" width={40} height={40} />
        </div>
      </Section>

      <Section title="Checkbox">
        <div className={ROW}>
          {CHECKBOX_STATES.map((state) => (
            <CheckboxDemo key={String(state)} initial={state}>
              {String(state)}
            </CheckboxDemo>
          ))}
          <CheckboxDemo initial={false} invalid>
            invalid
          </CheckboxDemo>
          <CheckboxDemo initial disabled>
            disabled
          </CheckboxDemo>
        </div>
      </Section>

      <Section title="SelectCard">
        <div className={COLUMN}>
          <SelectCardDemo />
        </div>
      </Section>

      <Section title="Segmented">
        <SegmentedDemo />
      </Section>

      <Section title="Modal">
        <ModalDemo />
      </Section>

      <Section title="Toast">
        <ToastDemo />
      </Section>

      <Section title="Mascot">
        <div className={ROW}>
          {MASCOT_POSES.map((pose) => (
            <Mascot key={pose} pose={pose} size={72} label={pose} />
          ))}
        </div>
      </Section>

      <Section title="EmptyState">
        <EmptyState
          pose="squint"
          title="empty state title"
          description="empty state description line"
          action={
            <Button variant="primary" size="lg">
              primary action
            </Button>
          }
          secondaryAction={
            <Button variant="text" size="lg">
              secondary action
            </Button>
          }
        />
      </Section>
    </main>
  )
}

export default App
