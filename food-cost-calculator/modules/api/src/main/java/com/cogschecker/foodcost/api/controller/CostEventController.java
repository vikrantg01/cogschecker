package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.service.CostEventSseService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.UUID;

/**
 * REST controller for real-time cost update events via Server-Sent Events (SSE).
 * <p>
 * Requirements: 3.3 - Real-time cost propagation notifications
 * <p>
 * Endpoint:
 * - GET /api/v1/venues/:venueId/cost-events - Subscribe to cost update events for a venue
 * <p>
 * Flow:
 * <ol>
 *   <li>Client opens an SSE connection to this endpoint</li>
 *   <li>Server subscribes to Redis pub/sub channel: venue:{venueId}:costs</li>
 *   <li>When CostPropagationWorker publishes COST_UPDATED events, they are forwarded to the client</li>
 *   <li>React Query on the frontend invalidates cache for affected recipe IDs</li>
 * </ol>
 * <p>
 * Event format (Server-Sent Events):
 * <pre>
 * event: COST_UPDATED
 * data: {"event":"COST_UPDATED","venueId":"uuid","recipeIds":["uuid1","uuid2"],"timestamp":1234567890}
 * </pre>
 * <p>
 * RBAC: All authenticated users with access to the venue can subscribe (read-only operation)
 */
@RestController
@RequestMapping("/api/v1/venues/{venueId}")
public class CostEventController {

    private static final Logger logger = LoggerFactory.getLogger(CostEventController.class);

    private final CostEventSseService costEventSseService;

    public CostEventController(CostEventSseService costEventSseService) {
        this.costEventSseService = costEventSseService;
    }

    /**
     * Subscribe to real-time cost update events for a venue via Server-Sent Events (SSE).
     * <p>
     * This endpoint establishes a long-lived HTTP connection that remains open to push
     * COST_UPDATED events to the client whenever recipe costs are recalculated.
     * <p>
     * The connection stays open until:
     * <ul>
     *   <li>The client closes the connection</li>
     *   <li>30 minutes elapse without activity (SSE timeout)</li>
     *   <li>An error occurs</li>
     * </ul>
     * <p>
     * Frontend usage (React):
     * <pre>
     * const eventSource = new EventSource(`/api/v1/venues/${venueId}/cost-events`, {
     *   headers: { Authorization: `Bearer ${token}` }
     * });
     * 
     * eventSource.addEventListener('COST_UPDATED', (event) => {
     *   const data = JSON.parse(event.data);
     *   // Invalidate React Query cache for affected recipe IDs
     *   data.recipeIds.forEach(id => queryClient.invalidateQueries(['recipe', id]));
     * });
     * </pre>
     * <p>
     * Requirements: 3.3
     * 
     * @param venueId the venue ID to subscribe to
     * @return SseEmitter for pushing events to the client
     */
    @GetMapping(value = "/cost-events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter subscribeToCostEvents(@PathVariable UUID venueId) {
        logger.info("SSE connection request for venue: {}", venueId);
        
        // TODO: Add RBAC check to verify user has access to this venue
        // For now, assuming Spring Security filter chain handles authentication
        
        return costEventSseService.subscribeToVenueCostUpdates(venueId);
    }
}
