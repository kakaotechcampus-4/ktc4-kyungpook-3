/*
 * 로그인 뒤 돌아갈 경로(`/login?next=`)를 읽는다 (#411).
 * 주소창의 값이라 누구나 고쳐 보낼 수 있다. 앱 안의 보호 경로만 받고 나머지는 모두 버린다 — 외부 주소로는 보내지 않는다.
 */

const MAX_LENGTH = 2048
const MAX_DECODE_ROUNDS = 5
/** 해석에만 쓰는 가짜 기준 주소. 결과의 origin 이 이것과 다르면 앱 밖을 가리킨 것이다 */
const BASE_ORIGIN = 'https://return.invalid'

/** 브라우저 URL 파서는 탭·줄바꿈을 지우고 `\` 를 `/` 로 읽는다. 둘 다 `//` 를 만들 수 있어 아예 받지 않는다 */
function hasUnsafeChar(value: string): boolean {
  return [...value].some((char) => {
    const code = char.charCodeAt(0)
    return code <= 0x1f || code === 0x7f || char === '\\'
  })
}

/** 여러 번 인코딩해 숨긴 값까지 본다. 끝까지 풀리지 않거나 잘못된 인코딩이면 null */
function fullyDecode(value: string): string | null {
  let current = value
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    let next: string
    try {
      next = decodeURIComponent(current)
    } catch {
      return null
    }
    if (next === current) return current
    current = next
  }
  return null
}

/** RequireAuth 안쪽 경로의 뿌리다 (app/router/routes.tsx). 인증 화면·모의 화면은 여기에 들지 않는다 */
function isProtectedPath(pathname: string): boolean {
  return (
    pathname === '/workspaces' ||
    pathname.startsWith('/workspaces/') ||
    pathname.startsWith('/onboarding/')
  )
}

/** 앱 안의 보호 경로면 정규화한 `pathname + search + hash` 를, 아니면 null 을 돌려준다 */
export function parseReturnPath(raw: string | null): string | null {
  if (raw === null || raw === '' || raw.length > MAX_LENGTH) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  const decoded = fullyDecode(raw)
  if (decoded === null || decoded.startsWith('//')) return null
  if (hasUnsafeChar(raw) || hasUnsafeChar(decoded)) return null

  let url: URL
  try {
    url = new URL(raw, BASE_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== BASE_ORIGIN) return null
  const decodedPathname = fullyDecode(url.pathname)
  if (decodedPathname === null || decodedPathname.includes('//')) return null
  if (!isProtectedPath(url.pathname)) return null
  return url.pathname + url.search + url.hash
}
