import { useMutation } from '@tanstack/react-query'
import guestAxios from '@/core/api/guest-axios.instance'
import { GUEST } from '@/core/api/routes'
import type { EntityCandidate } from '@/hooks/api/types'

export function useGuestResolveEntityMutation() {
  return useMutation({
    mutationFn: (body: { name: string; domain_hint?: string }) =>
      guestAxios
        .post<{ candidates: EntityCandidate[]; confidence: number }>(GUEST.RESOLVE(), body)
        .then((r) => r.data),
  })
}

export function useGuestConfirmEntityMutation() {
  return useMutation({
    mutationFn: (body: {
      legal_name: string
      domain: string
      candidate_id?: string | null
    }) => guestAxios.post<{ entity_id: string }>(GUEST.CONFIRM(), body).then((r) => r.data),
  })
}

export function useGuestCreateScanMutation() {
  return useMutation({
    mutationFn: (body: {
      entity_id: string
      legal_name: string
      domain: string
      company_name: string
    }) =>
      guestAxios.post<{ scan_id: string; status: string }>(GUEST.CREATE_SCAN(), body).then((r) => r.data),
  })
}
