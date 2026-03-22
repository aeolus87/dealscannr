import axios from 'axios'
import { BASE_URL } from '@/core/api/routes'
import { handle401Error } from '@/core/api/auth-redirect.helper'

const AUTH_STORAGE_KEY = 'dealscannr.auth'

function readTokenFromPersist(): string | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { state?: { token?: string | null } }
    const t = p?.state?.token
    return t && typeof t === 'string' ? t : null
  } catch {
    return null
  }
}

const axiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 120_000,
  headers: { 'Content-Type': 'application/json' },
})

axiosInstance.interceptors.request.use((config) => {
  const path = String(config.url ?? '')
  const skipAuth =
    path.includes('/api/auth/login') || path.includes('/api/auth/register')
  if (!skipAuth) {
    const token = readTokenFromPersist()
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }
  return config
})

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    handle401Error(error)
    return Promise.reject(error)
  },
)

export default axiosInstance
