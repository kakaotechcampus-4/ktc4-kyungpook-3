import type { ReactNode } from 'react'
import { Label } from '@/shared/ui/label'
import { Skeleton } from '@/shared/ui/skeleton'

/*
 * 인증 폼의 라우트 뼈대 (#510). 인증 틀이 세로 가운데 정렬이라 폼 칸 높이가 같아야 제목이 움직이지 않는다.
 * 그래서 폼과 같은 칸·간격으로 그린다 — 칸 이름·정해진 문구는 글자(Label 그대로), 입력·버튼은 같은 높이의 뼈대.
 * 치수는 LoginForm · SignupEmailStep · ForgotPasswordForm 과 TextField(auth) · Button(auth) · AlternativeAuth 와 같다.
 * 그쪽 틀이 바뀌면 여기도 맞춘다 — e2e/route-skeleton.e2e.ts 가 제목 자리를 잰다
 */

const FORM = 'flex flex-col gap-16'
const FOOTNOTE = 'text-center text-[14px] text-dim'
const FOOTNOTE_LINK = 'font-semibold text-ink underline underline-offset-3'
const LEAD = 'text-[14px] leading-[22px] text-dim'
const DIVIDER = 'self-center text-[13px] text-dim'
/* TextField(auth) 의 입력 높이·모서리, Button(auth) 의 높이·모서리 */
const INPUT = 'h-48 rounded-12'
const BUTTON = 'h-48 rounded-999'

/** 라벨과 입력 칸. 오른쪽 끝 글자는 라벨과 한 줄에 둔다. */
function FieldSkeleton({ label, end }: { label: string; end?: string }) {
  return (
    <div className="flex flex-col">
      {end === undefined ? (
        <Label tone="auth" className="mb-8">
          {label}
        </Label>
      ) : (
        <div className="mb-8 flex items-baseline justify-between">
          <Label tone="auth">{label}</Label>
          <span className="text-[13px] text-dim">{end}</span>
        </div>
      )}
      <Skeleton variant="block" className={INPUT} />
    </div>
  )
}

/** 폼 아래 버튼 — 폼과 버튼 사이 8px 를 더 띄운다(폼의 `mt-8`) */
function SubmitSkeleton() {
  return <Skeleton variant="block" className={`mt-8 ${BUTTON}`} />
}

/** `또는` 과 카카오 버튼(AlternativeAuth) */
function AlternativeSkeleton() {
  return (
    <>
      <span className={DIVIDER}>또는</span>
      <Skeleton variant="block" className={INPUT} />
    </>
  )
}

function Footnote({ lead, link }: { lead: string; link: ReactNode }) {
  return (
    <p className={FOOTNOTE}>
      {lead} <span className={FOOTNOTE_LINK}>{link}</span>
    </p>
  )
}

export function LoginFormSkeleton() {
  return (
    <>
      <div className={FORM}>
        <FieldSkeleton label="이메일" />
        <FieldSkeleton label="비밀번호" end="비밀번호를 잊으셨나요?" />
        <SubmitSkeleton />
      </div>
      <AlternativeSkeleton />
      <Footnote lead="처음이신가요?" link="회원가입" />
    </>
  )
}

export function SignupFormSkeleton() {
  return (
    <>
      <div className={FORM}>
        <FieldSkeleton label="이메일" />
        <SubmitSkeleton />
      </div>
      <AlternativeSkeleton />
      <Footnote lead="이미 계정이 있으신가요?" link="로그인" />
    </>
  )
}

export function ForgotPasswordFormSkeleton() {
  return (
    <>
      <div className={FORM}>
        <p className={LEAD}>가입한 이메일을 입력하면 비밀번호를 바꿀 수 있는 링크를 보내 드려요.</p>
        <FieldSkeleton label="이메일" />
        <SubmitSkeleton />
      </div>
      <Footnote lead="비밀번호가 생각나셨나요?" link="로그인" />
    </>
  )
}
