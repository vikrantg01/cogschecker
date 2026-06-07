import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useVenueStore } from '../../store/venueSlice';
import { useAuthStore } from '../../store/authSlice';

interface CostUpdatedEvent {
  event: 'COST_UPDATED';
  venueId: string;
  recipeIds: string[];
  timestamp: number;
}

/**
 * Hook to listen for real-time cost update events via Server-Sent Events (SSE).
 * 
 * This hook establishes an SSE connection to the backend and listens for COST_UPDATED
 * events. When a cost update is received (e.g., after an ingredient price change),
 * it invalidates the React Query cache for affected recipes, causing them to be
 * refetched with updated costs.
 * 
 * The SSE connection is automatically managed:
 * - Opens when a venue is selected
 * - Closes when the venue changes or component unmounts
 * - Automatically reconnects on connection failure
 * 
 * Event flow:
 * 1. User updates an ingredient price via the API
 * 2. CostPropagationWorker recalculates dependent recipe costs
 * 3. Worker publishes COST_UPDATED event to Redis pub/sub
 * 4. SSE service forwards event to connected clients
 * 5. This hook receives event and invalidates affected queries
 * 6. React Query refetches the updated recipe data
 * 
 * **Authentication Note:**
 * This implementation uses fetch() with manual SSE parsing instead of EventSource
 * to support the Authorization header. EventSource doesn't support custom headers
 * in the standard browser API.
 * 
 * @example
 * ```tsx
 * function RecipesPage() {
 *   // Automatically sets up SSE listener for cost updates
 *   useCostPropagation();
 *   
 *   const { data: recipes } = useQuery(['recipes', venueId], fetchRecipes);
 *   
 *   // When ingredient prices change, recipes will auto-refresh
 *   return <RecipeList recipes={recipes} />;
 * }
 * ```
 * 
 * Requirements: 3.3 - Real-time cost propagation
 */
export function useCostPropagation() {
  const queryClient = useQueryClient();
  const { currentVenueId } = useVenueStore();
  const { token } = useAuthStore();
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    // Only establish connection if we have a venue and are authenticated
    if (!currentVenueId || !token) {
      return;
    }

    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';
    const sseUrl = `${API_BASE_URL}/venues/${currentVenueId}/cost-events`;

    let isConnected = false;

    const connect = async () => {
      // Clean up any existing connection
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Clear any pending reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      console.log(`[useCostPropagation] Establishing SSE connection for venue: ${currentVenueId}`);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch(sseUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/event-stream',
            'Authorization': `Bearer ${token}`,
          },
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`SSE connection failed with status: ${response.status}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        isConnected = true;
        console.log(`[useCostPropagation] SSE connection established for venue: ${currentVenueId}`);

        // Read the stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            console.log('[useCostPropagation] SSE stream closed by server');
            break;
          }

          // Decode the chunk and add to buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete messages (delimited by double newline)
          const messages = buffer.split('\n\n');
          buffer = messages.pop() || ''; // Keep the incomplete message in buffer

          for (const message of messages) {
            if (!message.trim()) continue;

            try {
              const event = parseSSEMessage(message);
              handleSSEEvent(event, currentVenueId, queryClient);
            } catch (error) {
              console.error('[useCostPropagation] Failed to parse SSE message:', error);
            }
          }
        }

      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.log('[useCostPropagation] SSE connection aborted');
          return;
        }

        console.error('[useCostPropagation] SSE connection error:', error);

        // Attempt to reconnect after 5 seconds if we were connected or this is the first attempt
        if (isConnected || !isConnected) {
          console.log('[useCostPropagation] Scheduling reconnect in 5 seconds...');
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[useCostPropagation] Attempting to reconnect...');
            connect();
          }, 5000);
        }
      }
    };

    // Start the connection
    connect();

    // Cleanup function
    return () => {
      console.log(`[useCostPropagation] Cleaning up SSE connection for venue: ${currentVenueId}`);
      
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [currentVenueId, token, queryClient]);

  // This hook doesn't return anything - it just sets up the SSE listener
}

/**
 * Parse an SSE message string into an object.
 * 
 * SSE format:
 * event: COST_UPDATED
 * data: {"event":"COST_UPDATED","venueId":"uuid","recipeIds":[...]}
 */
function parseSSEMessage(message: string): { event: string; data: any } {
  const lines = message.split('\n');
  let eventType = 'message';
  let data = '';

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.substring(6).trim();
    } else if (line.startsWith('data:')) {
      data = line.substring(5).trim();
    }
  }

  return {
    event: eventType,
    data: data ? JSON.parse(data) : null,
  };
}

/**
 * Handle an SSE event by invalidating the appropriate queries.
 */
function handleSSEEvent(
  event: { event: string; data: any },
  currentVenueId: string,
  queryClient: any
) {
  if (event.event === 'connected') {
    console.log('[useCostPropagation] Connection confirmed:', event.data);
    return;
  }

  if (event.event === 'COST_UPDATED') {
    const data: CostUpdatedEvent = event.data;
    console.log(`[useCostPropagation] Received COST_UPDATED event:`, data);

    // Validate the event is for the current venue
    if (data.venueId !== currentVenueId) {
      console.warn(
        `[useCostPropagation] Received event for different venue. Expected: ${currentVenueId}, Got: ${data.venueId}`
      );
      return;
    }

    // Invalidate queries for affected recipes
    if (data.recipeIds && data.recipeIds.length > 0) {
      console.log(
        `[useCostPropagation] Invalidating queries for ${data.recipeIds.length} recipes`
      );

      // Invalidate individual recipe queries
      data.recipeIds.forEach((recipeId) => {
        queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] });
        queryClient.invalidateQueries({ queryKey: ['recipeDetail', recipeId] });
      });

      // Also invalidate the recipe list query to update the list view
      queryClient.invalidateQueries({ queryKey: ['recipes', currentVenueId] });

      // Invalidate the costing report query as costs have changed
      queryClient.invalidateQueries({ queryKey: ['costingReport', currentVenueId] });

      console.log(`[useCostPropagation] Cache invalidation completed`);
    }
  }
}
