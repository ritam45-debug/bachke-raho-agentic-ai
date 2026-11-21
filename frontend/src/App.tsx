import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import AppLayout from './components/AppLayout'
import { Loading, PageHeader, PhasePanel } from './components/ui'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import OverviewPage from './pages/app/Overview'
import { DisruptionsPage, InventoryPage, ProductsPage, ShipmentsPage, VendorsPage } from './pages/app/DataPages'
import SettingsPage from './pages/app/Settings'
import AuditPage from './pages/app/Audit'

function Protected({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth()
  if (loading) return <Loading />
  return me ? <>{children}</> : <Navigate to="/login" replace />
}

const PLANNED: { path: string; title: string; phase: number; items: string[] }[] = [
  { path: 'logistics', title: 'Logistics Analytics', phase: 3, items: ['Route and mode comparison with cost-benefit', 'Freight cost trend monitoring', 'Route reliability scoring', 'Bottleneck detection and alternative routes'] },
  { path: 'finance', title: 'Financial Intelligence', phase: 4, items: ['Procurement, holding and logistics cost analysis', 'Downtime and revenue-loss estimates (labelled as estimates)', 'Break-even, sensitivity and mitigation ROI', 'Financial impact report per disruption'] },
  { path: 'compliance', title: 'Legal & Compliance', phase: 5, items: ['Regulatory update monitoring with sources and effective dates', 'Affected products/shipments and missing documents', 'Facts kept separate from AI interpretation', 'Not a substitute for qualified legal advice'] },
  { path: 'consumer', title: 'Consumer Intelligence', phase: 5, items: ['Consent-based feedback forms and surveys', 'Sentiment and NPS', 'Recurring complaints and quality issues', 'Feedback linked to batches and shipments'] },
  { path: 'memory', title: 'Organisational Memory', phase: 5, items: ['Contracts, POs, policies and past decisions', 'Permission-aware document retrieval (pgvector)', 'History pulled in before every major recommendation', 'Admin review, export and deletion'] },
  { path: 'consulting', title: 'AI Consulting Centre', phase: 2, items: ['Claude-powered conversational assistant', 'Central orchestrator with stateful agent workflows', 'Explained recommendations and strategy comparison', 'Agent execution logs'] },
]

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/app" element={<Protected><AppLayout /></Protected>}>
            <Route index element={<OverviewPage />} />
            <Route path="disruptions" element={<DisruptionsPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="shipments" element={<ShipmentsPage />} />
            <Route path="vendors" element={<VendorsPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="settings" element={<SettingsPage />} />
            {PLANNED.map((p) => (
              <Route key={p.path} path={p.path} element={<><PageHeader title={p.title} /><PhasePanel phase={p.phase} title={p.title} items={p.items} /></>} />
            ))}
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
