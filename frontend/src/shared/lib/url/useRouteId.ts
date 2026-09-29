import { useParams } from 'react-router'
import { parseRouteId } from './params'

/** 현재 경로의 파라미터 하나를 ID 로 읽는다. 없거나 모양이 틀리면 null */
export function useRouteId(name: string): string | null {
  const params = useParams()
  return parseRouteId(params[name])
}
