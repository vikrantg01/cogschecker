import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/api';
import { useSubscriptionGate } from '../../shared/hooks/useSubscriptionGate';
import { UpgradeModal } from '../../shared/components';
import type { ApiError } from '../../types/api';

export const PasswordResetRequestPage = () => {
  const navigate = useNavigate();
  const { showUpgradeModal, requiredTier, upgradeMessage, closeModal, handleApiError } =
    useSubscriptionGate();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await apiClient.post<{ message: string }>(
        '/auth/password-reset/request',
        { email }
      );

      setSuccess(true);
      // Note: The backend always returns a generic success message to prevent email enumeration
    } catch (err: any) {
      if (!handleApiError(err)) {
        const apiError = err.response?.data as ApiError;
        setError(apiError?.message || 'Failed to send reset email. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <>
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-md w-full space-y-8">
            <div>
              <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
                Check your email
              </h2>
            </div>

            <div className="rounded-md bg-green-50 p-4">
              <div className="flex">
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-green-800">
                    Password reset email sent
                  </h3>
                  <p className="mt-2 text-sm text-green-700">
                    If an account exists with that email, a password reset link has been sent.
                    Please check your email within 2 minutes.
                  </p>
                </div>
              </div>
            </div>

            <div className="text-center">
              <Link
                to="/password-reset/confirm"
                className="font-medium text-blue-600 hover:text-blue-500"
              >
                I have a reset code →
              </Link>
            </div>

            <div className="text-center">
              <Link
                to="/login"
                className="font-medium text-gray-600 hover:text-gray-500"
              >
                Back to login
              </Link>
            </div>
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
      </>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Reset your password
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Enter your email address and we'll send you a reset code
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">{error}</h3>
              </div>
            </div>
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email-address" className="block text-sm font-medium text-gray-700">
              Email address
            </label>
            <input
              id="email-address"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Sending...' : 'Send reset code'}
            </button>
          </div>
        </form>

        <div className="text-center space-y-2">
          <div>
            <Link
              to="/password-reset/confirm"
              className="font-medium text-blue-600 hover:text-blue-500"
            >
              I already have a reset code
            </Link>
          </div>
          <div>
            <Link
              to="/login"
              className="font-medium text-gray-600 hover:text-gray-500"
            >
              Back to login
            </Link>
          </div>
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
