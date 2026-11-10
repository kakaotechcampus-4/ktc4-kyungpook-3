/** 팀원 이름을 비교하는 열쇠. 서버(validate_name)처럼 앞뒤 공백을 지우고 대소문자는 그대로 둔다 */
export function memberNameKey(name: string): string {
  return name.trim()
}
