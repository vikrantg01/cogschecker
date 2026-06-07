import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authSlice';
import { MainLayout } from '../layouts/MainLayout';

export const ProtectedRoute = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <MainLayout />;
};
