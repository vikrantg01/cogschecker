import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CostBadge,
  ThresholdIndicator,
  UomSelect,
  UpgradeModal,
} from '../shared/components';
import { useSubscriptionGate } from '../shared/hooks';
import type { UnitOfMeasure, SubscriptionTier } from '../types/api';

/**
 * ComponentDemoPage - demonstrates all shared UI components
 * 
 * This page showcases the CostBadge, ThresholdIndicator, UomSelect,
 * and UpgradeModal components with interactive examples.
 * 
 * Useful for visual testing and documentation purposes.
 */
export const ComponentDemoPage = () => {
  const navigate = useNavigate();
  const [selectedUom, setSelectedUom] = useState<UnitOfMeasure>('g');
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [demoTier, setDemoTier] = useState<SubscriptionTier>('pro');
  
  const {
    showUpgradeModal,
    requiredTier,
    upgradeMessage,
    closeModal,
  } = useSubscriptionGate();

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">Shared UI Components Demo</h1>

      {/* CostBadge Section */}
      <section className="mb-12 p-6 border border-gray-200 rounded-lg">
        <h2 className="text-2xl font-semibold mb-4">CostBadge</h2>
        <p className="text-gray-600 mb-4">
          Displays cost values with support for missing-price placeholders.
        </p>
        
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="w-40 text-sm font-medium">Regular cost:</span>
            <CostBadge value={12.5} />
          </div>
          
          <div className="flex items-center gap-3">
            <span className="w-40 text-sm font-medium">High precision:</span>
            <CostBadge value={45.6789} decimals={4} />
          </div>
          
          <div className="flex items-center gap-3">
            <span className="w-40 text-sm font-medium">Missing price:</span>
            <CostBadge value={null} />
          </div>
          
          <div className="flex items-center gap-3">
            <span className="w-40 text-sm font-medium">Zero cost:</span>
            <CostBadge value={0} />
          </div>
        </div>
      </section>

      {/* ThresholdIndicator Section */}
      <section className="mb-12 p-6 border border-gray-200 rounded-lg">
        <h2 className="text-2xl font-semibold mb-4">ThresholdIndicator</h2>
        <p className="text-gray-600 mb-4">
          Color-coded badge showing if food cost percentage exceeds or passes the target threshold.
        </p>
        
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="w-40 text-sm font-medium">Exceeding (35% &gt; 30%):</span>
            <ThresholdIndicator foodCostPercentage={35.5} threshold={30} />
          </div>
          
          <div className="flex items-center gap-3">
            <span className="w-40 text-sm font-medium">Passing (25% ≤ 30%):</span>
            <ThresholdIndicator foodCostPercentage={25.0} threshold={30} />
          </div>
          
          <div className="flex items-center gap-3">
            <span className="w-40 text-sm font-medium">At threshold:</span>
            <ThresholdIndicator foodCostPercentage={30.0} threshold={30} />
          </div>
          
          <div className="flex items-center gap-3">
            <span className="w-40 text-sm font-medium">Show value:</span>
            <ThresholdIndicator foodCostPercentage={28.3} threshold={30} showValue />
          </div>
          
          <div className="flex items-center gap-3">
            <span className="w-40 text-sm font-medium">No menu price:</span>
            <ThresholdIndicator foodCostPercentage={null} threshold={30} />
          </div>
        </div>
      </section>

      {/* UomSelect Section */}
      <section className="mb-12 p-6 border border-gray-200 rounded-lg">
        <h2 className="text-2xl font-semibold mb-4">UomSelect</h2>
        <p className="text-gray-600 mb-4">
          Grouped dropdown for selecting units of measure.
        </p>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Select a unit of measure:
            </label>
            <UomSelect
              value={selectedUom}
              onChange={setSelectedUom}
              className="w-64"
            />
            <p className="mt-2 text-sm text-gray-600">
              Selected: <code className="bg-gray-100 px-2 py-1 rounded">{selectedUom}</code>
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">
              Disabled state:
            </label>
            <UomSelect
              value="kg"
              onChange={() => {}}
              disabled
              className="w-64"
            />
          </div>
        </div>
      </section>

      {/* UpgradeModal Section */}
      <section className="mb-12 p-6 border border-gray-200 rounded-lg">
        <h2 className="text-2xl font-semibold mb-4">UpgradeModal</h2>
        <p className="text-gray-600 mb-4">
          Modal dialog triggered on 402 Payment Required responses.
        </p>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Select tier to demo:
            </label>
            <select
              value={demoTier}
              onChange={(e) => setDemoTier(e.target.value as SubscriptionTier)}
              className="px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="pro_plus">Pro+</option>
            </select>
          </div>
          
          <button
            onClick={() => setDemoModalOpen(true)}
            className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
          >
            Show Upgrade Modal
          </button>
        </div>
      </section>

      {/* Combined Example Section */}
      <section className="p-6 border border-gray-200 rounded-lg bg-blue-50">
        <h2 className="text-2xl font-semibold mb-4">Combined Example: Recipe Card</h2>
        <p className="text-gray-600 mb-4">
          Example showing all components working together in a recipe card.
        </p>
        
        <div className="bg-white border border-gray-300 rounded-lg p-4 max-w-md">
          <h3 className="text-lg font-semibold mb-3">Margherita Pizza</h3>
          
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Food cost per portion:</span>
              <CostBadge value={3.25} />
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Menu price:</span>
              <CostBadge value={12.0} />
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Status:</span>
              <ThresholdIndicator foodCostPercentage={27.1} threshold={30} showValue />
            </div>
            
            <div className="pt-3 border-t border-gray-200">
              <label className="block text-gray-600 mb-1">Measurement unit:</label>
              <UomSelect
                value={selectedUom}
                onChange={setSelectedUom}
                className="w-full"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Demo Modal */}
      <UpgradeModal
        isOpen={demoModalOpen}
        onClose={() => setDemoModalOpen(false)}
        requiredTier={demoTier}
        message={`This is a demo of the ${demoTier.toUpperCase()} tier upgrade modal.`}
        onUpgrade={() => {
          alert('Upgrade clicked! In a real app, this would navigate to /account/subscription');
          setDemoModalOpen(false);
        }}
      />

      {/* Hook-triggered Modal (for testing useSubscriptionGate) */}
      {requiredTier && (
        <UpgradeModal
          isOpen={showUpgradeModal}
          onClose={closeModal}
          requiredTier={requiredTier}
          message={upgradeMessage || undefined}
          onUpgrade={() => navigate('/account/subscription')}
        />
      )}
    </div>
  );
};
