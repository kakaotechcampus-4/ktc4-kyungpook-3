export function speakerTitle(index: number): string {
  return `화자 ${index + 1}`
}

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
