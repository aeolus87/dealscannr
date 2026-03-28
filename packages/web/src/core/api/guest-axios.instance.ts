import axios from 'axios'
import { BASE_URL } from '@/core/api/routes'

/** Guest trial scan API: httpOnly `ds_guest` cookie; do not send Bearer token. */
const guestAxios = axios.create({
  baseURL: BASE_URL,
  timeout: 120_000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

export default guestAxios
