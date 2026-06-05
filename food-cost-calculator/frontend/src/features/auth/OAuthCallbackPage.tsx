import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authSlice';
import { apiClient } from '../../lib/api';
import { useSubscriptionGate } from '../../shared/hooks/useSubscriptionGate';
import { UpgradeModal } from '../../shared/components';
import type { AuthResponse, ApiError } from '../../types/api';

export const OAuthCallbackPage = () => {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const { showUpgradeModal, requiredTier, upgradeMessage, closeModal, handleApiError } =
    useSubscriptionGate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(true);

  useEffect(() => {
    const handleOAuthCallback = async () => {
      try {
        // Check for error from Cognito (via backend redirect)
        const errorParam = searchParams.get('error');
        if (errorParam) {
          const errorDescription = searchParams.get('error_description') || 'Authentication failed';
          setError(decodeURIComponent(errorDescription));
          setProcessing(false);
          return;
        }

        // Get authorization code and provider from URL
        const code = searchParams.get('code');
        const provider = searchParams.get('provider') || 'google'; // default to google if not specified
        
        if (!code) {
          setError('No authorization code received');
          setProcessing(false);
          return;
        }

        // Build the redirect URI that was used during OAuth initiation
        const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';
        const redirectUri = `${apiBaseUrl}/auth/oauth/${provider}/callback`;

        // Exchange authorization code for tokens
        const response = await apiClient.post<AuthResponse>('/auth/oauth/token', {
          code,
          redirectUri,
        });

        const { accessToken, refreshToken, user } = response.data;
        
        // Store tokens and user info in auth state
        setAuth(accessToken, refreshToken, user);
        
        // Redirect to dashboard on success
        navigate('/dashboard');
        
      } catch (err: any) {
        console.error('OAuth callback error:', err);
        if (!handleApiError(err)) {
          const apiError = err.response?.data as ApiError;
          const errorMessage = apiError?.message || 'Authentication failed. Please try again.';
          setError(errorMessage);
        }
        setProcessing(false);
      }
    };

    handleOAuthCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, navigate, setAuth]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          {processing ? (
            <>
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <h2 className="text-2xl font-bold text-gray-900">Completing sign in...</h2>
              <p className="mt-2 text-sm text-gray-600">Please wait while we complete your authentication.</p>
            </>
          ) : error ? (
            <>
              <div className="rounded-md bg-red-50 p-4 mb-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">Authentication Failed</h3>
                    <p className="mt-2 text-sm text-red-700">{error}</p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => navigate('/login')}
                className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Return to login
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Upgrade Modal for 402 Payment Required */}
      {requiredTier && (
        <UpgradeModal
          isOpen={showUpgradeModal}
          onClose={closeModal}
          requiredTier={requiredTier}
          message={upgradeMessage || undefined}
          onUpgrade={() => {
            closeModal();
            navigate('/account/subscription');
          }}
        />
      )}
    </div>
  );
};
