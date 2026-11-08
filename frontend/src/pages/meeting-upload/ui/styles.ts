/* 회의 올리기 틀. 화면과 라우트 뼈대(UploadRouteSkeleton)가 같이 쓴다 (#510) */
/* Upload 캔버스 실측 — 위 48 · 아래 72, 본문 700px 한 단, 제목 30px (docs/impl-decision/2026-10-02-meeting-upload-screen.md) */
export const PAGE =
  'mx-auto flex w-full max-w-shell flex-1 justify-center px-48 pt-48 pb-72 max-md:px-20'
export const COLUMN = 'flex w-full max-w-[700px] flex-col gap-26'
export const TITLE = 'text-[30px] leading-[1.25] font-bold tracking-h1 text-ink'
export const LEAD = 'text-body text-sub'
export const TITLE_TEXT = '회의를 올려 주세요'
export const LEAD_TEXT = '정리가 끝나면 알려드릴게요. 정리하는 동안 다른 화면을 써도 괜찮아요.'
