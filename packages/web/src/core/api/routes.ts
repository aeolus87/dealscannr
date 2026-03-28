/** Absolute API origin (no trailing slash). Use for public URLs only; axios uses the same via baseURL. */
export const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5200').replace(/\/$/, '')

/** Full URL for a path that starts with `/api/...`. */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${BASE_URL}${p}`
}

export const AUTH = {
  LOGIN: () => '/api/auth/login',
  REGISTER: () => '/api/auth/register',
} as const

export const BILLING = {
  CHECKOUT: () => '/api/billing/checkout',
  PORTAL: () => '/api/billing/portal',
  STATUS: () => '/api/billing/status',
} as const

export const USERS = {
  ME_CREDITS: () => '/api/users/me/credits',
} as const

export const ENTITY = {
  RESOLVE: () => '/api/entity/resolve',
  CONFIRM: () => '/api/entity/confirm',
  AUTOCOMPLETE: (q: string) => `/api/entity/autocomplete?q=${encodeURIComponent(q)}`,
} as const

export const GUEST = {
  RESOLVE: () => '/api/guest/entity/resolve',
  CONFIRM: () => '/api/guest/entity/confirm',
  AUTOCOMPLETE: (q: string) =>
    `/api/guest/entity/autocomplete?q=${encodeURIComponent(q)}`,
  CREATE_SCAN: () => '/api/guest/scans',
  STATUS: (scanId: string) => `/api/guest/scans/${encodeURIComponent(scanId)}/status`,
  REPORT: (scanId: string) => `/api/guest/scans/${encodeURIComponent(scanId)}/report`,
} as const

export const SCANS = {
  CREATE: () => '/api/scans',
  HISTORY: (limit?: number) =>
    limit != null ? `/api/scans/history?limit=${limit}` : '/api/scans/history',
  STATUS: (scanId: string) => `/api/scans/${scanId}/status`,
  REPORT: (scanId: string) => `/api/scans/${scanId}/report`,
  PREVIOUS_SCAN: (scanId: string) => `/api/scans/${scanId}/previous-scan`,
  DIFF: (scanId: string) => `/api/scans/${scanId}/diff`,
  SHARE: (scanId: string) => `/api/scans/${scanId}/share`,
  REPORT_PDF: (scanId: string) => `/api/scans/${scanId}/report/pdf`,
  RESCAN: (scanId: string) => `/api/scans/${scanId}/rescan`,
} as const

export const SEARCH = {
  POST: () => '/api/search',
} as const

export const SHARE = {
  PUBLIC_REPORT: (token: string) => `/api/share/${encodeURIComponent(token)}`,
} as const

export const REPORTS = {
  BY_ID: (id: string) => `/api/reports/${id}`,
} as const

export const COMPANIES = {
  BY_SLUG: (slug: string) => `/api/companies/${encodeURIComponent(slug)}`,
} as const

export const WATCHLIST = {
  LIST: () => '/api/watchlist',
  ADD: () => '/api/watchlist',
  PATCH: (entityId: string) => `/api/watchlist/${encodeURIComponent(entityId)}`,
  REMOVE: (entityId: string) => `/api/watchlist/${encodeURIComponent(entityId)}`,
} as const

export const BATCH = {
  UPLOAD: () => '/api/batch',
  STATUS: (batchId: string) => `/api/batch/${encodeURIComponent(batchId)}`,
} as const

export const API_KEYS = {
  LIST: () => '/api/keys',
  CREATE: () => '/api/keys',
  DELETE: (keyPrefix: string) => `/api/keys/${encodeURIComponent(keyPrefix)}`,
} as const
