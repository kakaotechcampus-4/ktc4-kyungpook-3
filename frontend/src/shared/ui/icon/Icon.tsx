import type { ReactElement } from 'react'

/*
 * 캔버스 SVG 를 옮긴 선 아이콘. 경로·굵기는 캔버스 값 그대로다 — 다시 그리지 않는다.
 * 색은 currentColor 라 부모의 글자색(text-*)을 따른다. 캔버스의 stroke 16진수를 옮겨 적지 않는다.
 */

interface IconShape {
  /** 캔버스의 stroke-width */
  strokeWidth: number
  paths: ReactElement
}

const ICONS = {
  /** Main 팀 버튼 · 드롭다운 열기 */
  'chevron-down': { strokeWidth: 1.9, paths: <path d="m6 9 6 6 6-6" /> },
  /** Main · Landing 의 `확인하기` · `전부 보기` */
  'chevron-right': { strokeWidth: 2, paths: <path d="m9 6 6 6-6 6" /> },
  /** 온보딩 `이전 단계`. 캔버스에 없어 chevron-right 를 뒤집었다 */
  'chevron-left': { strokeWidth: 2, paths: <path d="m15 6-6 6 6 6" /> },
  /** Main 팀 메뉴의 현재 공간 · SetupNotion 연동 완료 */
  check: { strokeWidth: 2.2, paths: <path d="m5 13 4 4L19 7" /> },
  /** Main 팀 메뉴의 `새 팀 만들기` */
  plus: { strokeWidth: 1.9, paths: <path d="M12 5v14M5 12h14" /> },
  /** Main 팀 메뉴의 `팀 설정 · 초대` */
  settings: {
    strokeWidth: 1.7,
    paths: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 2.6 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.8-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 2.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.8l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.5 1Z" />
      </>
    ),
  },
  /** SetupMembers 의 Discord 사용자 → 팀원 */
  'arrow-right': { strokeWidth: 2, paths: <path d="M5 12h14m-6-6 6 6-6 6" /> },
  /** 온보딩 나가기(D-069). 캔버스에 없어 arrow-right 를 뒤집었다 */
  'arrow-left': { strokeWidth: 1.9, paths: <path d="M19 12H5m6 6-6-6 6-6" /> },
  /** Login·Signup 의 비밀번호 보기 */
  eye: {
    strokeWidth: 1.7,
    paths: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  /** 비밀번호 숨기기. 캔버스에 없어 eye 에 사선 하나를 긋는다 */
  'eye-off': {
    strokeWidth: 1.7,
    paths: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
        <path d="M4 4l16 16" />
      </>
    ),
  },
  /** Login·Signup 의 Google 버튼 */
  globe: {
    strokeWidth: 1.7,
    paths: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
        <path d="M3.5 9h17M3.5 15h17" />
      </>
    ),
  },
  /** 회의록 목록의 검색 */
  search: {
    strokeWidth: 1.8,
    paths: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </>
    ),
  },
  /** 회의록의 `원본 듣기` */
  play: {
    strokeWidth: 1.8,
    paths: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m10 8.5 6 3.5-6 3.5z" />
      </>
    ),
  },
  /** 회의록의 `Notion에서 보기` */
  external: {
    strokeWidth: 1.8,
    paths: (
      <>
        <path d="M15 3h6v6M10 14 21 3" />
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </>
    ),
  },
  /** 사용자 메뉴의 `로그아웃`. 캔버스에 없어 같은 선 굵기로 그렸다 */
  logout: {
    strokeWidth: 1.8,
    paths: (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5M21 12H9" />
      </>
    ),
  },
  /* 아래 넷은 Upload 캔버스 그대로다 — 끌어다 놓는 칸·고른 파일 카드·파일 제거·회의 날짜 */
  upload: {
    strokeWidth: 1.7,
    paths: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M17 8l-5-5-5 5M12 3v12" />
      </>
    ),
  },
  mic: {
    strokeWidth: 1.7,
    paths: (
      <>
        <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
      </>
    ),
  },
  close: { strokeWidth: 1.8, paths: <path d="M18 6 6 18M6 6l12 12" /> },
  calendar: {
    strokeWidth: 1.7,
    paths: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 11h18" />
      </>
    ),
  },
} as const satisfies Record<string, IconShape>

export type IconName = keyof typeof ICONS

export interface IconProps {
  name: IconName
  /** 한 변 px. 기본 16 */
  size?: number
  /** 캔버스 굵기를 바꿔야 하는 자리에서만 쓴다 */
  strokeWidth?: number
  className?: string
  /** 주면 role="img" + aria-label. 없으면 장식이라 aria-hidden 이다 */
  label?: string
}

/** 선 아이콘 하나. 뜻은 옆 글자나 버튼 이름이 주는 것이 기본이다 — 그래서 기본은 aria-hidden 이다 */
export function Icon({ name, size = 16, strokeWidth, className, label }: IconProps) {
  const shape: IconShape = ICONS[name]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? shape.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {shape.paths}
    </svg>
  )
}
