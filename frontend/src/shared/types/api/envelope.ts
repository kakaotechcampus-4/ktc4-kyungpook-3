export interface ApiErrorDto {
  code: string
  message: string
  details: Record<string, unknown> | null
}

export type Envelope<T> = { data: T; error: null } | { data: null; error: ApiErrorDto }

export interface ListDto<T> {
  items: T[]
  total: number
}
