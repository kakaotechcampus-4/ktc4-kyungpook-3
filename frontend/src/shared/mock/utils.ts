export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json()
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
export function nextId(prefix: string, ids: string[], minimum = 1): string {
  const next =
    Math.max(minimum - 1, ...ids.map((id) => Number(id.replace(`${prefix}_`, '')) || 0)) + 1
  return `${prefix}_${String(next).padStart(2, '0')}`
}
