/* 서버가 101자부터 400 으로 거절한다 */
export const NAME_MAX = 100

/** 그 자리 고치기 칸에 다는 표시. 창은 이 안의 Esc 로 닫히지 않는다 — Esc 는 고치기 취소다 */
export const EDITOR_ATTRIBUTE = 'data-member-name-editor'

/** Esc 가 이름 고치기 칸에서 눌렸다. 담는 창은 이때 닫히지 않아야 한다 */
export function isNameEditorEvent(event: Event): boolean {
  return event.target instanceof Element && event.target.closest(`[${EDITOR_ATTRIBUTE}]`) !== null
}
