import { z } from 'zod'

/** 비워 두면 동일 출처 `/api/v1` 이다. 개발 중에는 Vite proxy 가 이 경로를 백엔드로 넘긴다 */
export const DEFAULT_API_BASE_URL = '/api/v1'

const apiBaseUrl = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === '' || value.startsWith('/') || (/^https?:\/\//.test(value) && URL.canParse(value)),
    { message: 'VITE_API_BASE_URL 은 비우거나 / 로 시작하거나 http(s) 주소여야 한다' },
  )

const envSchema = z.object({
  VITE_API_BASE_URL: apiBaseUrl.optional(),
  VITE_ENABLE_MSW: z.enum(['true', 'false', '']).optional(),
})

export interface AppConfig {
  /** 끝 슬래시가 없는 API 루트. `/api/v1` 까지 포함한다 */
  apiBaseUrl: string
  /** 개발 서버이고 `VITE_ENABLE_MSW=true` 일 때만 true */
  mswEnabled: boolean
}

/** 환경 변수는 여기서만 읽는다 (D-139). 형식이 틀리면 앱을 띄우지 않는다 */
export function readConfig(env: unknown, isDev: boolean): AppConfig {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`환경 변수 형식이 올바르지 않습니다.\n${z.prettifyError(parsed.error)}`)
  }
  const base = parsed.data.VITE_API_BASE_URL ?? ''
  return {
    apiBaseUrl: base === '' ? DEFAULT_API_BASE_URL : base.replace(/\/+$/, ''),
    mswEnabled: isDev && parsed.data.VITE_ENABLE_MSW === 'true',
  }
}

export const config: AppConfig = readConfig(import.meta.env, import.meta.env.DEV)
