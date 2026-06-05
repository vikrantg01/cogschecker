import { createBrowserRouter } from 'react-router-dom';
import { RootLayout } from '../layouts/RootLayout';
import { AuthLayout } from '../layouts/AuthLayout';
import { ProtectedRoute } from '../components/ProtectedRoute';

// Auth pages
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { PasswordResetRequestPage } from '../features/auth/PasswordResetRequestPage';
import { PasswordResetConfirmPage } from '../features/auth/PasswordResetConfirmPage';
import { OAuthCallbackPage } from '../features/auth/OAuthCallbackPage';

// Main app pages
import { DashboardPage } from '../pages/DashboardPage';
import { IngredientsPage } from '../features/ingredients/IngredientsPage';
import { RecipesPage } from '../features/recipes/RecipesPage';
import { RecipeDetailPage } from '../features/recipes/RecipeDetailPage';
import { RecipeBuilderPage } from '../features/recipes/RecipeBuilderPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { VenuesPage } from '../features/venues/VenuesPage';
import { AccountPage } from '../features/account/AccountPage';
import { InsightsPage } from '../features/insights/InsightsPage';
import { InvoicesPage } from '../features/invoices/InvoicesPage';
import { SquarePage } from '../features/square/SquarePage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      // Auth pages (public)
      {
        element: <AuthLayout />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'register', element: <RegisterPage /> },
          { path: 'password-reset/request', element: <PasswordResetRequestPage /> },
          { path: 'password-reset/confirm', element: <PasswordResetConfirmPage /> },
          { path: 'oauth/google/callback', element: <OAuthCallbackPage /> },
          { path: 'oauth/apple/callback', element: <OAuthCallbackPage /> },
        ],
      },
      // Protected pages
      {
        path: '/',
        element: <ProtectedRoute />,
        children: [
          { path: 'dashboard', element: <DashboardPage /> },
          { index: true, element: <DashboardPage /> },
          { path: 'ingredients', element: <IngredientsPage /> },
          { path: 'recipes', element: <RecipesPage /> },
          { path: 'recipes/:id', element: <RecipeDetailPage /> },
          { path: 'recipes/new', element: <RecipeBuilderPage /> },
          { path: 'recipes/:id/edit', element: <RecipeBuilderPage /> },
          { path: 'reports', element: <ReportsPage /> },
          { path: 'venues', element: <VenuesPage /> },
          { path: 'account', element: <AccountPage /> },
          { path: 'insights', element: <InsightsPage /> },
          { path: 'invoices', element: <InvoicesPage /> },
          { path: 'square', element: <SquarePage /> },
        ],
      },
    ],
  },
]);
