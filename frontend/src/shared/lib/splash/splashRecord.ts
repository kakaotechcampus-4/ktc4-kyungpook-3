/*
 * 전체 스플래시를 마지막으로 보인 시각 (#510). 이 기기의 localStorage 에 epoch ms 로 둔다 — 서버가 쓸 일이 없어 쿠키가 아니다.
 * 민감하지 않은 UI 값이고 버전 붙은 키다(D-147 허용 목록).
 *
 * - 12시간 안에 보였으면 새로 접속해도 전체 스플래시를 건너뛴다. 값이 없거나 12시간이 지났거나 읽지 못하면 보인다.
 * - 값이 있기만 하면(시각과 상관없이) 이 브라우저는 서비스를 써 본 것이다. 바깥에서 `/` 로 오면 랜딩 대신 로그인이다.
 *
 * index.html 의 <head> 인라인 스크립트가 첫 페인트 전에 같은 키·간격으로 판정한다. 둘이 같은지는 app/splash/staticSplash.test.tsx 가 본다
 */

export const SPLASH_RECORD_KEY = 'splash-last-shown:v1'
/** 전체 스플래시를 다시 보이기까지의 간격 */
export const SPLASH_INTERVAL_MS = 12 * 60 * 60 * 1000

/** 저장된 값. 읽기가 막혔으면 undefined, 값이 없으면 null 이다 */
function readRecord(): string | null | undefined {
  try {
    return window.localStorage.getItem(SPLASH_RECORD_KEY)
  } catch {
    return undefined
  }
}

/**
 * 전체 스플래시를 보일 차례다. 값이 없거나, 시각으로 읽히지 않거나, 12시간이 지났거나, 시계가 뒤로 갔거나, 저장소를 못 쓰면 그렇다
 */
export function isSplashDue(now: number = Date.now()): boolean {
  const raw = readRecord()
  if (raw === null || raw === undefined) return true
  const shownAt = Number(raw)
  if (!Number.isFinite(shownAt) || shownAt <= 0) return true
  const age = now - shownAt
  return age < 0 || age >= SPLASH_INTERVAL_MS
}

/** 이 브라우저에서 전체 스플래시를 한 번이라도 보였다 — 서비스를 써 본 사람이다. 저장소를 못 쓰면 처음 온 사람으로 본다 */
export function hasSplashRecord(): boolean {
  const raw = readRecord()
  return raw !== null && raw !== undefined
}

/** 전체 스플래시가 실제로 보였다. 쓰기가 막혀도 조용히 넘어간다 — 다음에도 보일 뿐이다 */
export function markSplashShown(now: number = Date.now()): void {
  try {
    window.localStorage.setItem(SPLASH_RECORD_KEY, String(now))
  } catch {
    // 기록하지 못하면 다음 접속에도 전체 스플래시를 보인다
  }
}
