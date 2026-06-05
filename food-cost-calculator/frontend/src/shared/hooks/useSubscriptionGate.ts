import { useState } from 'react';
import { AxiosError } from 'axios';
import type { SubscriptionTier, UpgradePrompt } from '../../types/api';

interface UseSubscriptionGateReturn {
  /**
   * Whether the upgrade modal should be shown.
   */
  showUpgradeModal: boolean;
  /**
   * The required tier for the upgrade modal.
   */
  requiredTier: SubscriptionTier | null;
  /**
   * The message to display in the upgrade modal.
   */
  upgradeMessage: string | null;
  /**
   * Call this function to close the upgrade modal.
   */
  closeModal: () => void;
  /**
   * Call this function with an API error to check if it's a 402
   * and automatically show the upgrade modal if needed.
   * Returns true if it was a 402 error, false otherwise.
   */
  handleApiError: (error: unknown) => boolean;
}

/**
 * useSubscriptionGate - hook for handling 402 Payment Required responses.
 * 
 * When an API call returns 402, this hook extracts the upgrade prompt
 * information and manages the state needed to show the UpgradeModal.
 * 
 * @example
 * const { showUpgradeModal, requiredTier, upgradeMessage, closeModal, handleApiError } =
 *   useSubscriptionGate();
 * 
 * const createRecipe = async () => {
 *   try {
 *     await api.post('/recipes', data);
 *   } catch (error) {
 *     if (!handleApiError(error)) {
 *       // Handle other errors
 *     }
 *   }
 * };
 * 
 * return (
 *   <>
 *     <button onClick={createRecipe}>Create Recipe</button>
 *     <UpgradeModal
 *       isOpen={showUpgradeModal}
 *       onClose={closeModal}
 *       requiredTier={requiredTier!}
 *       message={upgradeMessage}
 *       onUpgrade={() => navigate('/account/subscription')}
 *     />
 *   </>
 * );
 */
export const useSubscriptionGate = (): UseSubscriptionGateReturn => {
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [requiredTier, setRequiredTier] = useState<SubscriptionTier | null>(null);
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);

  const closeModal = () => {
    setShowUpgradeModal(false);
    setRequiredTier(null);
    setUpgradeMessage(null);
  };

  const handleApiError = (error: unknown): boolean => {
    // Check if this is an Axios error with a 402 status
    if (error && typeof error === 'object' && 'response' in error) {
      const axiosError = error as AxiosError<UpgradePrompt>;
      
      if (axiosError.response?.status === 402) {
        const data = axiosError.response.data;
        
        // Extract tier and message from response
        if (data && data.requiredTier) {
          setRequiredTier(data.requiredTier);
          setUpgradeMessage(data.message || null);
          setShowUpgradeModal(true);
          return true;
        }
      }
    }
    
    return false;
  };

  return {
    showUpgradeModal,
    requiredTier,
    upgradeMessage,
    closeModal,
    handleApiError,
  };
};
