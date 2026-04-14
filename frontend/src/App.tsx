import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AvailabilityConfigPage } from './pages/AvailabilityConfigPage'
import { DashboardPage } from './pages/DashboardPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/availability" element={<AvailabilityConfigPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
