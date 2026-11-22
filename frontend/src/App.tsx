import type { ReactNode } from 'react'
import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { PREVIEW } from './lib/api'
import PreviewRibbon from './preview/PreviewRibbon'
import { AuthProvider, useAuth } from './lib/auth'
import AppLayout from './components/AppLayout'
import { Loading } from './components/ui'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import OverviewPage from './pages/app/Overview'
import { DisruptionsPage, InventoryPage, ShipmentsPage } from './pages/app/DataPages'
import VendorsPage from './pages/app/Vendors'
import FinancePage from './pages/app/Finance'
import LifecyclePage from './pages/app/Lifecycle'
import CompliancePage from './pages/app/Compliance'
import ConsumerPage from './pages/app/Consumer'
import MemoryPage from './pages/app/Memory'
import ApprovalsPage from './pages/app/Approvals'
import SettingsPage from './pages/app/Settings'
import AuditPage from './pages/app/Audit'
import RiskMapPage from './pages/app/RiskMap'
import WeatherPage from './pages/app/Weather'
import ConsultingPage from './pages/app/Consulting'
import DataImportPage from './pages/app/DataImport'
import LogisticsPage from './pages/app/Logistics'

function Protected({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth()
  if (loading) return <Loading />
  return me ? <>{children}</> : <Navigate to="/login" replace />
}


// The artifact frame only passes plain #names, so the preview keeps routes in memory.
const Router = PREVIEW ? MemoryRouter : BrowserRouter

export default function App() {
  return (
    <AuthProvider>
      <Router>
        {PREVIEW && <PreviewRibbon />}
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/app" element={<Protected><AppLayout /></Protected>}>
            <Route index element={<OverviewPage />} />
            <Route path="map" element={<RiskMapPage />} />
            <Route path="weather" element={<WeatherPage />} />
            <Route path="consulting" element={<ConsultingPage />} />
            <Route path="logistics" element={<LogisticsPage />} />
            <Route path="import" element={<DataImportPage />} />
            <Route path="disruptions" element={<DisruptionsPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="shipments" element={<ShipmentsPage />} />
            <Route path="vendors" element={<VendorsPage />} />
            <Route path="products" element={<LifecyclePage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="compliance" element={<CompliancePage />} />
            <Route path="consumer" element={<ConsumerPage />} />
            <Route path="memory" element={<MemoryPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}
