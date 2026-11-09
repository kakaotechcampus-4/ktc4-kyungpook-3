import {
  UPLOAD_EXTERNAL_PROCESSING_NOTICE,
  UPLOAD_NOTION_NOTICE,
} from '@/shared/config/meetingUpload'
import { Skeleton } from '@/shared/ui/skeleton'
import { COLUMN, LEAD, LEAD_TEXT, PAGE, TITLE, TITLE_TEXT } from './styles'

/**
 * 올릴 수 있는지 확인하는 동안의 뼈대 (#508). 업로드 폼과 같은 틀이다 — 파일 끌어 놓기 칸, 회의 정보 칸(제목 · 날짜 · 참석자).
 * 정해진 글자(칸 이름)는 글자로 그린다. 자리표시라 스크린리더에서 뺀다. 치수는 AudioDropzone 의 ZONE, MeetingUploadForm 의
 * ROOT · FIELDS · ROW 와 같다
 */
export function UploadSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-26">
      {/* 파일 칸은 정해진 글자뿐이라 글자로 그린다 — AudioDropzone 의 ZONE · ICON_BOX · HEADLINE · SUBLINE · LIMITS 와 같다 */}
      <div className="flex flex-col items-center gap-14 rounded-16 border border-line bg-surface-sunken px-32 py-44 text-center">
        <span className="inline-flex h-48 w-48 items-center justify-center rounded-9 border border-input-border bg-surface" />
        <div className="flex flex-col items-center gap-5">
          <p className="text-[15px] font-semibold text-ink">파일을 여기로 끌어다 놓으세요</p>
          <p className="text-control font-normal text-dim">
            또는 <span className="text-ink underline underline-offset-3">컴퓨터에서 찾기</span>
          </p>
        </div>
        <p className="text-meta text-dim tabular-nums">
          mp3 · wav · m4a · ogg · webm — 최대 200 MiB · 2시간
        </p>
      </div>
      <div className="flex flex-col gap-18 rounded-16 border border-line bg-surface p-22">
        <div className="grid grid-cols-[minmax(0px,1fr)_200px] gap-14 max-md:grid-cols-1">
          {['회의 제목', '회의 날짜'].map((label) => (
            <div key={label} className="flex flex-col gap-6">
              <span className="text-caption text-sub">{label}</span>
              <Skeleton variant="block" height={45} className="rounded-9" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-6">
          <span className="text-caption text-sub">참석자</span>
          <Skeleton variant="block" width={64} height={32} className="rounded-9" />
          <div className="flex h-lh items-center text-caption">
            <Skeleton width={240} />
          </div>
        </div>
      </div>
      {/* 아래 줄 — 안내 문구와 `정리 시작하기` (MeetingUploadForm 의 FOOTER) */}
      <div className="flex items-center justify-between gap-20 max-md:flex-wrap">
        <div className="flex min-w-0 flex-1 flex-col gap-10 max-md:basis-full">
          <p className="text-caption text-dim">{UPLOAD_EXTERNAL_PROCESSING_NOTICE}</p>
          <p className="text-caption text-dim">{UPLOAD_NOTION_NOTICE}</p>
        </div>
        <Skeleton variant="block" width={132} height={44} className="rounded-9" />
      </div>
    </div>
  )
}

/**
 * 회의 올리기의 라우트 뼈대 (#510). 화면이 올릴 수 있는지 확인할 때와 같다 — 제목·안내와 업로드 폼 뼈대(#508).
 * 기다림은 main 의 aria-busy 가 알린다
 */
export function UploadRouteSkeleton() {
  return (
    <main aria-busy="true" className={PAGE}>
      <div className={COLUMN}>
        <div aria-hidden="true" className="flex flex-col gap-8">
          <p className={TITLE}>{TITLE_TEXT}</p>
          <p className={LEAD}>{LEAD_TEXT}</p>
        </div>
        <div>
          <UploadSkeleton />
        </div>
      </div>
    </main>
  )
}
