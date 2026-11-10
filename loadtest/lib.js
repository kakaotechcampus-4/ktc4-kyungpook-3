import http from 'k6/http'
import { fail } from 'k6'

export const BASE = `${__ENV.BASE_URL || 'http://127.0.0.1:18000'}/api/v1`
export const WORKSPACES = Number(__ENV.LT_WORKSPACES || 5)
const PATTERN = __ENV.LT_EMAIL_PATTERN || 'lt-w{w}-p{n}@example.com'

export function pmEmail(w) {
  return PATTERN.replace('{w}', String(w)).replace('{n}', '1')
}

// 부하 단계마다 constant-vus 시나리오 하나. 단계별 p50·p95 가 요약에 따로 남게 하려고 단계마다 임계값을 건다
export function stages(levels, seconds, exec) {
  const scenarios = {}
  const thresholds = {}
  levels.forEach((vus, i) => {
    const name = `vus_${String(vus).padStart(3, '0')}`
    scenarios[name] = {
      executor: 'constant-vus', exec, vus, duration: `${seconds}s`,
      startTime: `${i * (seconds + 5)}s`, gracefulStop: '5s',
    }
    thresholds[`http_req_duration{scenario:${name}}`] = ['p(95)>=0']
    thresholds[`http_req_failed{scenario:${name}}`] = ['rate>=0']
  })
  return { scenarios, thresholds, summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'] }
}

export function levels(fallback) {
  return (__ENV.LT_LEVELS || fallback).split(',').map(Number)
}

// 세션 쿠키는 Secure 라 k6 쿠키 저장소가 http 로는 보내지 않는다. 직접 헤더로 붙인다
export function login(email, password) {
  const res = http.post(`${BASE}/auth/login`, JSON.stringify({ email, password }), {
    headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /auth/login' },
  })
  const cookie = res.cookies.session_token
  if (res.status !== 200 || !cookie) fail(`login ${res.status}`)
  return { Cookie: `session_token=${cookie[0].value}` }
}

export function data(res) {
  return res.json('data')
}
