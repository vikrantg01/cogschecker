package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.Subscription;
import com.cogschecker.foodcost.api.domain.SubscriptionTier;
import com.cogschecker.foodcost.api.repository.SubscriptionRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.stripe.model.Event;
import com.stripe.net.Webhook;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Integration tests for Stripe webhook handler.
 * 
 * Tests the following webhook events:
 * - payment_intent.payment_succeeded: Payment success clears failure flag
 * - payment_intent.payment_failed: Payment failure sets timestamp
 * - invoice.payment_failed: Invoice failure triggers 7-day grace period
 * - customer.subscription.deleted: Subscription deletion downgrades to Free
 * 
 * Requirements: 11.4, 11.5, 11.6, 11.7, 11.8
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@ActiveProfiles("test")
@TestPropertySource(properties = {
    "stripe.webhook.secret=whsec_test_secret",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.datasource.url=jdbc:h2:mem:webhooktest",
    "spring.flyway.enabled=false",
    // Disable Redis for this test
    "spring.data.redis.repositories.enabled=false"
})
@Import(WebhookControllerIntegrationTest.TestConfig.class)
class WebhookControllerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private SubscriptionRepository subscriptionRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Value("${stripe.webhook.secret}")
    private String webhookSecret;

    private UUID organisationId;
    private String stripeCustomerId;
    private String stripeSubscriptionId;
    private Subscription testSubscription;

    @BeforeEach
    void setUp() {
        organisationId = UUID.randomUUID();
        stripeCustomerId = "cus_test_" + UUID.randomUUID().toString().substring(0, 8);
        stripeSubscriptionId = "sub_test_" + UUID.randomUUID().toString().substring(0, 8);

        // Create test subscription
        testSubscription = new Subscription();
        testSubscription.setOrganisationId(organisationId);
        testSubscription.setTier(SubscriptionTier.PRO);
        testSubscription.setStripeCustomerId(stripeCustomerId);
        testSubscription.setStripeSubscriptionId(stripeSubscriptionId);
        testSubscription = subscriptionRepository.save(testSubscription);
    }

    /**
     * Test payment_intent.payment_succeeded event.
     * Requirement 11.8: Payment success should clear payment failure flag
     */
    @Test
    void handleWebhook_paymentSucceeded_clearsPaymentFailureFlag() throws Exception {
        // Given - subscription with payment failure flag set
        testSubscription.setPaymentFailedAt(Instant.now().minus(2, ChronoUnit.DAYS));
        subscriptionRepository.save(testSubscription);

        // Create Stripe payment_intent.payment_succeeded event payload
        String eventJson = String.format("""
            {
              "id": "evt_test_%s",
              "object": "event",
              "api_version": "2023-10-16",
              "created": %d,
              "type": "payment_intent.payment_succeeded",
              "data": {
                "object": {
                  "id": "pi_test_%s",
                  "object": "payment_intent",
                  "amount": 2000,
                  "currency": "usd",
                  "customer": "%s",
                  "status": "succeeded"
                }
              }
            }
            """,
            UUID.randomUUID().toString().substring(0, 8),
            Instant.now().getEpochSecond(),
            UUID.randomUUID().toString().substring(0, 8),
            stripeCustomerId
        );

        // Generate valid Stripe signature
        String signature = generateStripeSignature(eventJson);

        // When - send webhook
        mockMvc.perform(post("/api/v1/webhooks/stripe")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Stripe-Signature", signature)
                .content(eventJson))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("success"));

        // Then - payment failure flag should be cleared
        Subscription updated = subscriptionRepository.findById(testSubscription.getId()).orElseThrow();
        assertThat(updated.getPaymentFailedAt()).isNull();
        assertThat(updated.getTier()).isEqualTo(SubscriptionTier.PRO);
    }

    /**
     * Test payment_intent.payment_failed event.
     * Requirement 11.8: Payment failure should set timestamp
     */
    @Test
    void handleWebhook_paymentFailed_setsPaymentFailureTimestamp() throws Exception {
        // Given - subscription with no payment failure
        assertThat(testSubscription.getPaymentFailedAt()).isNull();

        // Create Stripe payment_intent.payment_failed event payload
        String eventJson = String.format("""
            {
              "id": "evt_test_%s",
              "object": "event",
              "api_version": "2023-10-16",
              "created": %d,
              "type": "payment_intent.payment_failed",
              "data": {
                "object": {
                  "id": "pi_test_%s",
                  "object": "payment_intent",
                  "amount": 2000,
                  "currency": "usd",
                  "customer": "%s",
                  "status": "failed"
                }
              }
            }
            """,
            UUID.randomUUID().toString().substring(0, 8),
            Instant.now().getEpochSecond(),
            UUID.randomUUID().toString().substring(0, 8),
            stripeCustomerId
        );

        String signature = generateStripeSignature(eventJson);

        // When - send webhook
        mockMvc.perform(post("/api/v1/webhooks/stripe")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Stripe-Signature", signature)
                .content(eventJson))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("success"));

        // Then - payment failure timestamp should be set
        Subscription updated = subscriptionRepository.findById(testSubscription.getId()).orElseThrow();
        assertThat(updated.getPaymentFailedAt()).isNotNull();
        assertThat(updated.getTier()).isEqualTo(SubscriptionTier.PRO);
    }

    /**
     * Test invoice.payment_failed event within grace period.
     * Requirement 11.8: Invoice payment failure should not downgrade if within 7 days
     */
    @Test
    void handleWebhook_invoicePaymentFailed_withinGracePeriod_noDowngrade() throws Exception {
        // Given - subscription with no payment failure
        assertThat(testSubscription.getPaymentFailedAt()).isNull();

        // Create Stripe invoice.payment_failed event payload
        String eventJson = String.format("""
            {
              "id": "evt_test_%s",
              "object": "event",
              "api_version": "2023-10-16",
              "created": %d,
              "type": "invoice.payment_failed",
              "data": {
                "object": {
                  "id": "in_test_%s",
                  "object": "invoice",
                  "amount_due": 2000,
                  "currency": "usd",
                  "customer": "%s",
                  "subscription": "%s",
                  "status": "open"
                }
              }
            }
            """,
            UUID.randomUUID().toString().substring(0, 8),
            Instant.now().getEpochSecond(),
            UUID.randomUUID().toString().substring(0, 8),
            stripeCustomerId,
            stripeSubscriptionId
        );

        String signature = generateStripeSignature(eventJson);

        // When - send webhook
        mockMvc.perform(post("/api/v1/webhooks/stripe")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Stripe-Signature", signature)
                .content(eventJson))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("success"));

        // Then - payment failure timestamp set but no downgrade
        Subscription updated = subscriptionRepository.findById(testSubscription.getId()).orElseThrow();
        assertThat(updated.getPaymentFailedAt()).isNotNull();
        assertThat(updated.getTier()).isEqualTo(SubscriptionTier.PRO); // Still PRO
    }

    /**
     * Test invoice.payment_failed event after 7-day grace period.
     * Requirement 11.8: If payment remains unsuccessful after 7 days, downgrade to Free
     */
    @Test
    void handleWebhook_invoicePaymentFailed_after7Days_downgradestoFree() throws Exception {
        // Given - subscription with payment failure 8 days ago
        Instant eightDaysAgo = Instant.now().minus(8, ChronoUnit.DAYS);
        testSubscription.setPaymentFailedAt(eightDaysAgo);
        subscriptionRepository.save(testSubscription);

        // Create Stripe invoice.payment_failed event payload
        String eventJson = String.format("""
            {
              "id": "evt_test_%s",
              "object": "event",
              "api_version": "2023-10-16",
              "created": %d,
              "type": "invoice.payment_failed",
              "data": {
                "object": {
                  "id": "in_test_%s",
                  "object": "invoice",
                  "amount_due": 2000,
                  "currency": "usd",
                  "customer": "%s",
                  "subscription": "%s",
                  "status": "open"
                }
              }
            }
            """,
            UUID.randomUUID().toString().substring(0, 8),
            Instant.now().getEpochSecond(),
            UUID.randomUUID().toString().substring(0, 8),
            stripeCustomerId,
            stripeSubscriptionId
        );

        String signature = generateStripeSignature(eventJson);

        // When - send webhook
        mockMvc.perform(post("/api/v1/webhooks/stripe")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Stripe-Signature", signature)
                .content(eventJson))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("success"));

        // Then - subscription should be downgraded to Free
        Subscription updated = subscriptionRepository.findById(testSubscription.getId()).orElseThrow();
        assertThat(updated.getTier()).isEqualTo(SubscriptionTier.FREE);
        assertThat(updated.getStripeSubscriptionId()).isNull();
    }

    /**
     * Test customer.subscription.deleted event.
     * Requirement 11.8: Subscription deletion should downgrade to Free tier
     */
    @Test
    void handleWebhook_subscriptionDeleted_downgradestoFree() throws Exception {
        // Given - active Pro subscription
        assertThat(testSubscription.getTier()).isEqualTo(SubscriptionTier.PRO);

        // Create Stripe customer.subscription.deleted event payload
        String eventJson = String.format("""
            {
              "id": "evt_test_%s",
              "object": "event",
              "api_version": "2023-10-16",
              "created": %d,
              "type": "customer.subscription.deleted",
              "data": {
                "object": {
                  "id": "%s",
                  "object": "subscription",
                  "customer": "%s",
                  "status": "canceled",
                  "cancel_at_period_end": false
                }
              }
            }
            """,
            UUID.randomUUID().toString().substring(0, 8),
            Instant.now().getEpochSecond(),
            stripeSubscriptionId,
            stripeCustomerId
        );

        String signature = generateStripeSignature(eventJson);

        // When - send webhook
        mockMvc.perform(post("/api/v1/webhooks/stripe")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Stripe-Signature", signature)
                .content(eventJson))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("success"));

        // Then - subscription should be downgraded to Free
        Subscription updated = subscriptionRepository.findById(testSubscription.getId()).orElseThrow();
        assertThat(updated.getTier()).isEqualTo(SubscriptionTier.FREE);
        assertThat(updated.getStripeSubscriptionId()).isNull();
        assertThat(updated.getPaymentFailedAt()).isNull();
    }

    /**
     * Test customer.subscription.deleted when already on Free tier.
     * Should be idempotent - no error when already Free
     */
    @Test
    void handleWebhook_subscriptionDeleted_alreadyFree_noChange() throws Exception {
        // Given - subscription already on Free tier
        testSubscription.setTier(SubscriptionTier.FREE);
        testSubscription.setStripeSubscriptionId(null);
        subscriptionRepository.save(testSubscription);

        // Create Stripe customer.subscription.deleted event payload
        String eventJson = String.format("""
            {
              "id": "evt_test_%s",
              "object": "event",
              "api_version": "2023-10-16",
              "created": %d,
              "type": "customer.subscription.deleted",
              "data": {
                "object": {
                  "id": "%s",
                  "object": "subscription",
                  "customer": "%s",
                  "status": "canceled"
                }
              }
            }
            """,
            UUID.randomUUID().toString().substring(0, 8),
            Instant.now().getEpochSecond(),
            stripeSubscriptionId,
            stripeCustomerId
        );

        String signature = generateStripeSignature(eventJson);

        // When - send webhook
        mockMvc.perform(post("/api/v1/webhooks/stripe")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Stripe-Signature", signature)
                .content(eventJson))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("success"));

        // Then - subscription remains Free (idempotent)
        Subscription updated = subscriptionRepository.findById(testSubscription.getId()).orElseThrow();
        assertThat(updated.getTier()).isEqualTo(SubscriptionTier.FREE);
    }

    /**
     * Test invalid webhook signature.
     * Should reject with 401 Unauthorized
     */
    @Test
    void handleWebhook_invalidSignature_returnsUnauthorized() throws Exception {
        // Given - event with invalid signature
        String eventJson = """
            {
              "id": "evt_test_invalid",
              "object": "event",
              "type": "payment_intent.payment_succeeded",
              "data": {
                "object": {
                  "id": "pi_test",
                  "customer": "cus_test"
                }
              }
            }
            """;

        String invalidSignature = "t=1234567890,v1=invalidsignature";

        // When/Then - webhook should reject invalid signature
        mockMvc.perform(post("/api/v1/webhooks/stripe")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Stripe-Signature", invalidSignature)
                .content(eventJson))
            .andExpect(status().isUnauthorized());
    }

    /**
     * Test webhook with unknown customer ID.
     * Should return 200 but not modify anything
     */
    @Test
    void handleWebhook_unknownCustomer_returns200() throws Exception {
        // Given - event for unknown customer
        String unknownCustomerId = "cus_unknown_" + UUID.randomUUID().toString().substring(0, 8);

        String eventJson = String.format("""
            {
              "id": "evt_test_%s",
              "object": "event",
              "api_version": "2023-10-16",
              "created": %d,
              "type": "payment_intent.payment_succeeded",
              "data": {
                "object": {
                  "id": "pi_test_%s",
                  "object": "payment_intent",
                  "customer": "%s"
                }
              }
            }
            """,
            UUID.randomUUID().toString().substring(0, 8),
            Instant.now().getEpochSecond(),
            UUID.randomUUID().toString().substring(0, 8),
            unknownCustomerId
        );

        String signature = generateStripeSignature(eventJson);

        // When - send webhook for unknown customer
        mockMvc.perform(post("/api/v1/webhooks/stripe")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Stripe-Signature", signature)
                .content(eventJson))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("success"));

        // Then - original subscription unchanged
        Subscription unchanged = subscriptionRepository.findById(testSubscription.getId()).orElseThrow();
        assertThat(unchanged.getTier()).isEqualTo(SubscriptionTier.PRO);
        assertThat(unchanged.getPaymentFailedAt()).isNull();
    }

    /**
     * Test unhandled event type.
     * Should return 200 (acknowledge receipt) but take no action
     */
    @Test
    void handleWebhook_unhandledEventType_returns200() throws Exception {
        // Given - unhandled event type
        String eventJson = String.format("""
            {
              "id": "evt_test_%s",
              "object": "event",
              "api_version": "2023-10-16",
              "created": %d,
              "type": "customer.updated",
              "data": {
                "object": {
                  "id": "%s",
                  "object": "customer"
                }
              }
            }
            """,
            UUID.randomUUID().toString().substring(0, 8),
            Instant.now().getEpochSecond(),
            stripeCustomerId
        );

        String signature = generateStripeSignature(eventJson);

        // When - send unhandled event
        mockMvc.perform(post("/api/v1/webhooks/stripe")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Stripe-Signature", signature)
                .content(eventJson))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("success"));

        // Then - subscription unchanged
        Subscription unchanged = subscriptionRepository.findById(testSubscription.getId()).orElseThrow();
        assertThat(unchanged.getTier()).isEqualTo(SubscriptionTier.PRO);
    }

    /**
     * Test Pro+ tier downgrade after 7 days.
     * Requirements: 11.8
     */
    @Test
    void handleWebhook_invoicePaymentFailed_proPlusTierAfter7Days_downgradestoFree() throws Exception {
        // Given - Pro+ subscription with payment failure 8 days ago
        testSubscription.setTier(SubscriptionTier.PRO_PLUS);
        Instant eightDaysAgo = Instant.now().minus(8, ChronoUnit.DAYS);
        testSubscription.setPaymentFailedAt(eightDaysAgo);
        subscriptionRepository.save(testSubscription);

        // Create invoice payment failed event
        String eventJson = String.format("""
            {
              "id": "evt_test_%s",
              "object": "event",
              "api_version": "2023-10-16",
              "created": %d,
              "type": "invoice.payment_failed",
              "data": {
                "object": {
                  "id": "in_test_%s",
                  "object": "invoice",
                  "customer": "%s",
                  "subscription": "%s"
                }
              }
            }
            """,
            UUID.randomUUID().toString().substring(0, 8),
            Instant.now().getEpochSecond(),
            UUID.randomUUID().toString().substring(0, 8),
            stripeCustomerId,
            stripeSubscriptionId
        );

        String signature = generateStripeSignature(eventJson);

        // When - send webhook
        mockMvc.perform(post("/api/v1/webhooks/stripe")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Stripe-Signature", signature)
                .content(eventJson))
            .andExpect(status().isOk());

        // Then - Pro+ should downgrade to Free
        Subscription updated = subscriptionRepository.findById(testSubscription.getId()).orElseThrow();
        assertThat(updated.getTier()).isEqualTo(SubscriptionTier.FREE);
        assertThat(updated.getStripeSubscriptionId()).isNull();
    }

    /**
     * Helper method to generate valid Stripe signature for testing.
     * Uses Webhook.Util.computeHmacSha256 to generate HMAC-SHA256 signature.
     */
    private String generateStripeSignature(String payload) {
        long timestamp = Instant.now().getEpochSecond();
        String signedPayload = timestamp + "." + payload;
        
        try {
            String signature = com.stripe.net.Webhook.Util.computeHmacSha256(webhookSecret, signedPayload);
            return String.format("t=%d,v1=%s", timestamp, signature);
        } catch (Exception e) {
            throw new RuntimeException("Failed to generate Stripe signature", e);
        }
    }

    /**
     * Test configuration to provide mock Redis beans.
     */
    @Configuration
    static class TestConfig {
        @Bean
        public RedisConnectionFactory redisConnectionFactory() {
            return mock(RedisConnectionFactory.class);
        }
    }
}
