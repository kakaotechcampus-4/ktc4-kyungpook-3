import { useStartKakao } from '../model/useStartKakao'

const DIVIDER = 'self-center text-[13px] text-dim'

/* 색·반경·문구는 카카오 로그인 디자인 가이드가 정한 값이라 토큰을 쓰지 않는다 */
const KAKAO_BUTTON =
  'flex h-48 w-full items-center justify-center gap-8 rounded-[12px] bg-[#FEE500] text-[15px] font-semibold text-black/85'

/** 카카오 가이드의 말풍선 심볼. 모양·비율·색을 바꾸면 안 된다 */
function KakaoSymbol() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="61 16 14 14" fill="none">
      <path
        d="M68.001 16.5225C64.4222 16.5225 61.5225 19.0037 61.5225 22.0641C61.5225 24.0312 62.7219 25.7596 64.5292 26.7423L63.9181 29.2113C63.8954 29.285 63.9132 29.364 63.9619 29.4184C63.9975 29.457 64.0461 29.478 64.0931 29.478C64.1337 29.478 64.1742 29.464 64.2082 29.4341L66.834 27.5144C67.2117 27.5723 67.6007 27.6039 67.9994 27.6039C71.5767 27.6039 74.478 25.1226 74.478 22.0623C74.478 19.002 71.5783 16.5225 68.001 16.5225Z"
        fill="#191919"
      />
    </svg>
  )
}

/** `또는` 과 카카오 버튼. 누르면 현재 탭이 카카오로 간다 (D-180) */
export function AlternativeAuth() {
  const startKakao = useStartKakao()
  return (
    <>
      <span className={DIVIDER}>또는</span>
      <button type="button" className={KAKAO_BUTTON} onClick={startKakao}>
        <KakaoSymbol />
        카카오 로그인
      </button>
    </>
  )
}
