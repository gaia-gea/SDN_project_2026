import type {
  TrafficAgentResult,
  TrafficParams,
} from '@/types'

const DEFAULT_AGENT_PORT = 5000
const REQUEST_TIMEOUT_MS = 8_000

export interface AgentHealth {
  status: 'ok'
  hostname?: string
  running: boolean
}

interface StartResponse {
  status: 'started'
  pid?: number
  job?: unknown
}

interface StopResponse {
  status: 'stopped' | 'idle'
}

/**
 * Accepts an IP/hostname (10.0.0.1) or a complete URL
 * (http://10.0.0.1:5000) and returns a normalized base URL.
 */
export const getAgentBaseUrl = (address: string): string => {
  const value = address.trim().replace(/\/$/, '')
  if (!value) throw new Error('Agent address is empty')

  if (/^https?:\/\//i.test(value)) return value

  const hasExplicitPort = value.includes(':')
  return `http://${value}${hasExplicitPort ? '' : `:${DEFAULT_AGENT_PORT}`}`
}

const requestJson = async <T>(
  address: string,
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  )

  try {
    const response = await fetch(`${getAgentBaseUrl(address)}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })

    const text = await response.text()
    let data: unknown = {}

    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(`Agent returned invalid JSON (HTTP ${response.status})`)
      }
    }

    if (!response.ok) {
      const message =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error: unknown }).error)
          : `Agent request failed with HTTP ${response.status}`
      throw new Error(message)
    }

    return data as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Agent ${address} did not respond within ${REQUEST_TIMEOUT_MS / 1000}s`)
    }

    if (error instanceof TypeError) {
      throw new Error(
        `Cannot reach agent ${address}. Check its IP, port, CORS and network routing.`,
      )
    }

    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export const checkAgentHealth = (address: string): Promise<AgentHealth> =>
  requestJson<AgentHealth>(address, '/health')

export const startTraffic = (
  address: string,
  params: TrafficParams,
): Promise<StartResponse> =>
  requestJson<StartResponse>(address, '/start', {
    method: 'POST',
    body: JSON.stringify(params),
  })

export const stopTraffic = (address: string): Promise<StopResponse> =>
  requestJson<StopResponse>(address, '/stop', { method: 'POST' })

export const pollTrafficResult = (
  address: string,
): Promise<TrafficAgentResult> =>
  requestJson<TrafficAgentResult>(address, '/result')
