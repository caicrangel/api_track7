import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { OperatorProvider } from './lib/operator';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { VehiclesPage } from './pages/Vehicles';
import { DriversPage } from './pages/Drivers';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { UsersPage } from './pages/Users';
import { HelpPage } from './pages/Help';
import { OperatorsPage } from './pages/Operators';
import { ProfilePage } from './pages/Profile';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Carregando sessão..." />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <OperatorProvider>
      <Layout />
    </OperatorProvider>
  );
}

function PublicOnly({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <PublicOnly>
                  <LoginPage />
                </PublicOnly>
              }
            />
            <Route element={<ProtectedRoutes />}>
              <Route index element={<DashboardPage />} />
              <Route path="veiculos" element={<VehiclesPage />} />
              <Route path="motoristas" element={<DriversPage />} />
              <Route path="relatorios" element={<ReportsPage />} />
              <Route path="configuracoes" element={<SettingsPage />} />
              <Route path="operadoras" element={<OperatorsPage />} />
              <Route path="usuarios" element={<UsersPage />} />
              <Route path="ajuda" element={<HelpPage />} />
              <Route path="perfil" element={<ProfilePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
