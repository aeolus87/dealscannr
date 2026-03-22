import axios from 'axios'

export function getAxiosStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined
}

/** Human-readable message from API JSON (FastAPI `raise_api_error` uses top-level `message`). */
export function getAxiosResponseMessage(error: unknown): string | undefined {
  if (!axios.isAxiosError(error)) return undefined
  const d = error.response?.data
  if (!d || typeof d !== 'object') return undefined
  const top = (d as { message?: unknown }).message
  if (typeof top === 'string' && top.trim()) return top
  const detail = (d as { detail?: unknown }).detail
  if (detail && typeof detail === 'object' && detail !== null && !Array.isArray(detail)) {
    const m = (detail as { message?: unknown }).message
    if (typeof m === 'string' && m.trim()) return m
  }
  if (typeof detail === 'string' && detail.trim()) return detail
  return undefined
}
