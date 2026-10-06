/**
 * 참석자 줄 한 줄에 이름 칩을 몇 개 보일지 (UX1-M03). 모두 들어가면 모두 보인다. 아니면 앞에서부터 넣되,
 * 그 뒤에 `+N` 칩 자리를 함께 남길 수 있는 데까지만 넣는다. 폭은 화면이 잰 값(px)이고, 칩 사이 간격은 `gap` 하나다.
 *
 * @param chipWidths 이름 칩 폭 — 보일 순서대로
 * @param available 참석자 줄의 폭
 * @param moreWidth `+N` 칩 폭. N 의 자릿수에 따라 달라지므로 가장 긴 경우(`+전체 인원`)로 잰다
 * @returns 보일 이름 칩 수 (0 이상, 전체 이하)
 */
export function fitAttendees(
  chipWidths: readonly number[],
  available: number,
  gap: number,
  moreWidth: number,
): number {
  const lineWidth = (count: number) =>
    chipWidths.slice(0, count).reduce((sum, width) => sum + width, 0) + gap * Math.max(count - 1, 0)

  if (lineWidth(chipWidths.length) <= available) return chipWidths.length
  // 한 사람이라도 남으면 `+N` 이 있다 — 이름 칩 뒤에 간격 하나와 `+N` 칩이 붙는다
  let shown = 0
  while (shown < chipWidths.length - 1 && lineWidth(shown + 1) + gap + moreWidth <= available)
    shown++
  return shown
}
