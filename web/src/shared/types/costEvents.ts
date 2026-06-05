/**
 * Cost update event payload from SSE endpoint.
 * 
 * Requirements: 3.3 - Real-time cost propagation
 */
export interface CostUpdatedEvent {
  event: 'COST_UPDATED';
  venueId: string;
  recipeIds: string[];
  timestamp: number;
}

/**
 * EventSource message type for SSE.
 */
export interface SSEMessage {
  data: string;
  type?: string;
}
