import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayoutShell } from '@/components/layout/AppLayout'
import { Batch } from '@/pages/Batch'
import { Dashboard } from '@/pages/Dashboard'
import { Home } from '@/pages/Home'
import { Login } from '@/pages/Login'
import { Methodology } from '@/pages/Methodology'
import { Pricing } from '@/pages/Pricing'
import { Register } from '@/pages/Register'
import { Report } from '@/pages/Report'
import { ScanProgress } from '@/pages/ScanProgress'
import { ScanReport } from '@/pages/ScanReport'
import { Settings } from '@/pages/Settings'
import { SharedReport } from '@/pages/SharedReport'
import { TryScan } from '@/pages/TryScan'
import { Watchlist } from '@/pages/Watchlist'

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="/share/:token" element={<SharedReport />} />
          <Route path="/report/:slug" element={<Report />} />
          <Route path="/try" element={<TryScan />} />
          <Route path="/try/scan/:scanId/progress" element={<ScanProgress guestMode />} />
          <Route path="/try/scan/:scanId/report" element={<ScanReport guestMode />} />

          <Route element={<AppLayoutShell />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/batch" element={<Batch />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/scan/:scanId/progress" element={<ScanProgress />} />
            <Route path="/scan/:scanId/report" element={<ScanReport />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
