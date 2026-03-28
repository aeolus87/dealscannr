import { useMutation, useQuery } from '@tanstack/react-query'
import axiosInstance from '@/core/api/axios.instance'
import guestAxios from '@/core/api/guest-axios.instance'
import { GUEST, SCANS } from '@/core/api/routes'
import type { ScanDiffPayload } from '@/components/scans/DiffModal'
import type { HistoryRow, ScanReportPayload, ScanStatusPayload } from '@/hooks/api/types'

export function useScanHistoryQuery(enabled: boolean, limit = 10) {
  return useQuery({
    queryKey: ['scan-history', limit],
    enabled,
    queryFn: async () => {
      const { data } = await axiosInstance.get<{ scans: HistoryRow[] }>(SCANS.HISTORY(limit))
      return data.scans ?? []
    },
  })
}

export function useScanReportQuery(scanId: string | undefined, guest?: boolean) {
  return useQuery({
    queryKey: ['scan-report', scanId, guest ? 'guest' : 'auth'],
    enabled: Boolean(scanId),
    retry: 1,
    queryFn: async () => {
      const path = guest ? GUEST.REPORT(scanId!) : SCANS.REPORT(scanId!)
      const client = guest ? guestAxios : axiosInstance
      const { data } = await client.get<ScanReportPayload>(path)
      return data
    },
  })
}

export function usePreviousScanQuery(scanId: string | undefined, guest?: boolean) {
  return useQuery({
    queryKey: ['previous-scan', scanId, guest ? 'guest' : 'auth'],
    enabled: Boolean(scanId) && !guest,
    retry: 0,
    queryFn: async () => {
      const { data } = await axiosInstance.get<{ previous_scan_id: string | null }>(
        SCANS.PREVIOUS_SCAN(scanId!),
      )
      return data
    },
  })
}

export function useScanStatusQuery(scanId: string | undefined, guest?: boolean) {
  return useQuery({
    queryKey: ['scan-status', scanId, guest ? 'guest' : 'auth'],
    enabled: Boolean(scanId),
    /** Guest trial: poll faster so progress feels responsive. */
    refetchInterval: guest ? 1000 : 2000,
    /** Default false: polling pauses in background tabs so lanes look stuck while elapsed still runs. */
    refetchIntervalInBackground: true,
    staleTime: 0,
    queryFn: async () => {
      const path = guest ? GUEST.STATUS(scanId!) : SCANS.STATUS(scanId!)
      const client = guest ? guestAxios : axiosInstance
      const { data } = await client.get<ScanStatusPayload>(path)
      return data
    },
  })
}

export function useCreateScanMutation() {
  return useMutation({
    mutationFn: (body: {
      entity_id: string
      legal_name: string
      domain: string
      company_name: string
    }) =>
      axiosInstance.post<{ scan_id: string; status: string }>(SCANS.CREATE(), body).then((r) => r.data),
  })
}

export async function fetchScanDiff(scanId: string, compareTo: string): Promise<ScanDiffPayload> {
  const { data } = await axiosInstance.get<ScanDiffPayload>(SCANS.DIFF(scanId), {
    params: { compare_to: compareTo },
  })
  return data
}

export async function postScanShare(scanId: string): Promise<{ share_url: string; expires_at: string }> {
  const { data } = await axiosInstance.post<{ share_url: string; expires_at: string }>(
    SCANS.SHARE(scanId),
  )
  return data
}

export async function getScanReportPdf(scanId: string): Promise<{ blob: Blob; filename: string }> {
  const res = await axiosInstance.get(SCANS.REPORT_PDF(scanId), { responseType: 'blob' })
  const cd = res.headers['content-disposition'] as string | undefined
  let filename = 'dealscannr-report.pdf'
  const m = cd?.match(/filename="([^"]+)"/)
  if (m?.[1]) filename = m[1]
  return { blob: res.data as Blob, filename }
}

export async function postRescan(scanId: string): Promise<{ new_scan_id: string }> {
  const { data } = await axiosInstance.post<{ new_scan_id: string }>(SCANS.RESCAN(scanId))
  return data
}
