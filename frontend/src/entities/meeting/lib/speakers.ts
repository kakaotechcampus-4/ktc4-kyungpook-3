/** 화자 라벨의 화면 이름. 응답 순서로 매긴다 — 라벨 문자열(`SPEAKER_00`)은 파싱하지 않는다 */
export function speakerTitle(index: number): string {
  return `화자 ${index + 1}`
}

/** 총 발화 시간. 초는 반올림하고 1초가 안 되면 따로 말한다 */
export function speakingTime(totalSec: number): string {
  const seconds = Math.round(totalSec)
  if (seconds < 1) return '1초 미만'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [
    hours > 0 ? `${hours}시간` : null,
    minutes > 0 ? `${minutes}분` : null,
    rest > 0 ? `${rest}초` : null,
  ]
    .filter((part) => part !== null)
    .join(' ')
}
