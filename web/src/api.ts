export type Share = {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Balance = { memberId: string; name: string; outstandingCents: number }
export type PaidShare = { id: string; memberId: string; amountCents: number; paidAt: string | null }

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const TIMEOUT_MS = 10_000

function errorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    if (typeof data.error === 'string') return data.error
  }
  return fallback
}

// Every call goes through here: JSON in, JSON out, a timeout, and one error type.
// A dead, slow or crashing API turns into an ApiError the page can show.
export async function request<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(path, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      throw new ApiError(errorMessage(data, `Request failed (${response.status})`), response.status)
    }
    return data as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The server took too long to respond.', 0)
    }
    throw new ApiError('Could not reach the server.', 0)
  } finally {
    clearTimeout(timer)
  }
}

// Money stays in whole cents. 123456 -> "1234.56"
export function formatCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

// "12.5" -> 1250. Returns null for anything that isn't a positive amount with at most 2 decimals.
export function parseDollarsToCents(input: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return cents > 0 ? cents : null
}
