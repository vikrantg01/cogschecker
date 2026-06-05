// API entity types based on backend design

export interface Venue {
  id: string;
  organisationId: string;
  name: string;
  address?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Ingredient {
  id: string;
  venueId: string;
  name: string;
  purchasePrice: number;
  purchaseQuantity: number;
  unitOfMeasure: UnitOfMeasure;
  yieldPercentage: number;
  costPerUnit: number;
  effectiveCostPerUsableUnit: number;
  createdAt: string;
  updatedAt: string;
}

export interface Recipe {
  id: string;
  venueId: string;
  name: string;
  portionCount: number;
  menuSellingPrice?: number;
  totalBatchCost: number;
  foodCostPerPortion: number;
  foodCostPercentage?: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeIngredientLine {
  id: string;
  recipeId: string;
  ingredientId?: string;
  subRecipeId?: string;
  quantityUsed: number;
  unitOfMeasure: UnitOfMeasure;
  lineCost: number;
}

export interface RecipeWithDetails extends Recipe {
  ingredientLines: RecipeIngredientLine[];
  costBreakdown: CostBreakdownLine[];
}

export interface CostBreakdownLine {
  name: string;
  quantity: number;
  unitOfMeasure: UnitOfMeasure;
  unitCost?: number;
  lineCost?: number;
  missingPrice: boolean;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface Organisation {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  organisationId: string;
  tier: SubscriptionTier;
  currentPeriodEnd?: string;
  pendingDowngradeTier?: SubscriptionTier;
  paymentFailedAt?: string;
}

export type SubscriptionTier = 'free' | 'pro' | 'pro_plus';

export type UnitOfMeasure = 
  | 'g' | 'kg' | 'oz' | 'lb'           // Weight
  | 'ml' | 'L' | 'tsp' | 'tbsp' | 'cup' // Volume
  | 'each';                             // Count

export type UserRole = 'admin' | 'manager' | 'staff';

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
  code?: string;
}

export interface UpgradePrompt {
  requiredTier: SubscriptionTier;
  message: string;
}
