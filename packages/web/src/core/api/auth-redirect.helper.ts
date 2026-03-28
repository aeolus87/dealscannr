import axios from 'axios'
import { useAuthStore } from '@/stores/authStore'

/** On 401, clear session and send user to login (except when already on /login). */
export function handle401Error(error: unknown): void {
  if (!axios.isAxiosError(error) || error.response?.status !== 401) return
  const url = String(error.config?.url ?? '')
  if (url.includes('/api/guest/')) return
  if (url.includes('/api/share/')) return
  if (url.includes('/api/auth/login') || url.includes('/api/auth/register')) return
  useAuthStore.getState().logout()
  const path = window.location.pathname
  if (!path.startsWith('/login')) {
    window.location.assign('/login')
  }
}
