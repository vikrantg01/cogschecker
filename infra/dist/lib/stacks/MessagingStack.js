"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessagingStack = void 0;
const cdk = require("aws-cdk-lib");
const sqs = require("aws-cdk-lib/aws-sqs");
const cloudwatch = require("aws-cdk-lib/aws-cloudwatch");
/**
 * MessagingStack
 *
 * Provisions the asynchronous messaging infrastructure for the Food Cost Calculator:
 *
 *  • Four FIFO queues with content-based deduplication:
 *    - cost-propagation.fifo   — triggers recipe cost recalculation when ingredient prices change
 *    - ocr-processing.fifo     — processes supplier invoice uploads via AWS Textract
 *    - ai-insights.fifo        — generates AI-driven profitability and supplier insights
 *    - square-sync.fifo        — synchronizes menu item sales data from Square POS API
 *
 *  • Dead-letter queues (DLQ) for each main queue:
 *    - maxReceiveCount = 3    — messages move to DLQ after 3 failed processing attempts
 *    - 14-day retention       — matches main queue retention for audit and replay
 *
 *  • CloudWatch alarms on DLQ depth:
 *    - Alarm fires when any DLQ depth > 0 (signals processing failures requiring investigation)
 *    - Alarms are created for each DLQ separately for granular alerting
 *
 * Satisfies Requirements:
 *  - 3.3:  Cost propagation within 2 seconds of ingredient price update
 *  - 12.7: OCR processing within 30 seconds of invoice upload
 *  - 13.4: AI insights refresh within 24 hours of new data
 */
class MessagingStack extends cdk.Stack {
    /** Cost propagation queue — used when ingredient prices change to trigger recipe recalculation */
    costPropagationQueue;
    /** OCR processing queue — used for invoice upload and Textract extraction */
    ocrProcessingQueue;
    /** AI insights queue — used for generating profitability and supplier insights */
    aiInsightsQueue;
    /** Square sync queue — used for polling and syncing Square POS sales data */
    squareSyncQueue;
    /** Dead-letter queue for cost propagation failures */
    costPropagationDlq;
    /** Dead-letter queue for OCR processing failures */
    ocrProcessingDlq;
    /** Dead-letter queue for AI insights generation failures */
    aiInsightsDlq;
    /** Dead-letter queue for Square sync failures */
    squareSyncDlq;
    /** CloudWatch alarm for cost propagation DLQ depth */
    costPropagationDlqAlarm;
    /** CloudWatch alarm for OCR processing DLQ depth */
    ocrProcessingDlqAlarm;
    /** CloudWatch alarm for AI insights DLQ depth */
    aiInsightsDlqAlarm;
    /** CloudWatch alarm for Square sync DLQ depth */
    squareSyncDlqAlarm;
    constructor(scope, id, props) {
        super(scope, id, props);
        const { envName } = props;
        // ── Retention and DLQ Configuration ──────────────────────────────────────
        const messageRetentionDays = 14;
        const maxReceiveCount = 3; // Move to DLQ after 3 failed attempts
        // ══════════════════════════════════════════════════════════════════════════
        // 1. Cost Propagation Queue
        // ══════════════════════════════════════════════════════════════════════════
        //
        // Purpose:
        //   Triggered when an ingredient's purchase price, purchase quantity, or yield
        //   percentage changes. Worker recalculates food cost per portion for all recipes
        //   that directly or transitively reference the ingredient.
        //
        // SLA (Requirement 3.3): Recalculation within 2 seconds of update.
        //
        // FIFO guarantees order-preserving processing for multiple updates to the same
        // ingredient. Content-based deduplication prevents duplicate propagation jobs
        // within the 5-minute deduplication window.
        this.costPropagationDlq = new sqs.Queue(this, 'CostPropagationDlq', {
            queueName: `fcc-cost-propagation-dlq-${envName}.fifo`,
            fifo: true,
            contentBasedDeduplication: true,
            retentionPeriod: cdk.Duration.days(messageRetentionDays),
        });
        this.costPropagationQueue = new sqs.Queue(this, 'CostPropagationQueue', {
            queueName: `fcc-cost-propagation-${envName}.fifo`,
            fifo: true,
            contentBasedDeduplication: true,
            retentionPeriod: cdk.Duration.days(messageRetentionDays),
            visibilityTimeout: cdk.Duration.seconds(30), // 30 seconds to process propagation
            deadLetterQueue: {
                queue: this.costPropagationDlq,
                maxReceiveCount,
            },
        });
        // ══════════════════════════════════════════════════════════════════════════
        // 2. OCR Processing Queue
        // ══════════════════════════════════════════════════════════════════════════
        //
        // Purpose:
        //   Triggered when a user uploads a supplier invoice (PDF or image). Worker
        //   calls AWS Textract to extract ingredient names, quantities, units, and prices,
        //   then stores the extracted line items for user review.
        //
        // SLA (Requirement 12.7): Extraction and display within 30 seconds of upload.
        //
        // FIFO ensures invoices from the same venue are processed in upload order.
        // Content-based deduplication prevents re-processing the same invoice file
        // if the user accidentally triggers multiple uploads.
        this.ocrProcessingDlq = new sqs.Queue(this, 'OcrProcessingDlq', {
            queueName: `fcc-ocr-processing-dlq-${envName}.fifo`,
            fifo: true,
            contentBasedDeduplication: true,
            retentionPeriod: cdk.Duration.days(messageRetentionDays),
        });
        this.ocrProcessingQueue = new sqs.Queue(this, 'OcrProcessingQueue', {
            queueName: `fcc-ocr-processing-${envName}.fifo`,
            fifo: true,
            contentBasedDeduplication: true,
            retentionPeriod: cdk.Duration.days(messageRetentionDays),
            visibilityTimeout: cdk.Duration.seconds(60), // 60 seconds for Textract API call + parsing
            deadLetterQueue: {
                queue: this.ocrProcessingDlq,
                maxReceiveCount,
            },
        });
        // ══════════════════════════════════════════════════════════════════════════
        // 3. AI Insights Queue
        // ══════════════════════════════════════════════════════════════════════════
        //
        // Purpose:
        //   Triggered when new sales data is synced from Square or new invoice data
        //   is confirmed. Worker calls Amazon Bedrock (Anthropic Claude) to generate
        //   recipe profitability insights and supplier cost insights.
        //
        // SLA (Requirement 13.4): Insights refresh within 24 hours of new data.
        //
        // FIFO ensures insights for the same venue are generated sequentially.
        // Content-based deduplication prevents redundant insight generation for
        // duplicate trigger events within the deduplication window.
        this.aiInsightsDlq = new sqs.Queue(this, 'AiInsightsDlq', {
            queueName: `fcc-ai-insights-dlq-${envName}.fifo`,
            fifo: true,
            contentBasedDeduplication: true,
            retentionPeriod: cdk.Duration.days(messageRetentionDays),
        });
        this.aiInsightsQueue = new sqs.Queue(this, 'AiInsightsQueue', {
            queueName: `fcc-ai-insights-${envName}.fifo`,
            fifo: true,
            contentBasedDeduplication: true,
            retentionPeriod: cdk.Duration.days(messageRetentionDays),
            visibilityTimeout: cdk.Duration.minutes(5), // 5 minutes for Bedrock API call + analysis
            deadLetterQueue: {
                queue: this.aiInsightsDlq,
                maxReceiveCount,
            },
        });
        // ══════════════════════════════════════════════════════════════════════════
        // 4. Square Sync Queue
        // ══════════════════════════════════════════════════════════════════════════
        //
        // Purpose:
        //   Triggered on a schedule (at least once every 24 hours) or on-demand when
        //   the user triggers a manual sync. Worker polls the Square POS API to fetch
        //   menu item sales data, then matches Square items to recipes by name and
        //   updates menu selling prices.
        //
        // SLA (Requirement 12.2): Sync at least once every 24 hours.
        //
        // FIFO ensures syncs for the same venue are processed sequentially.
        // Content-based deduplication prevents duplicate syncs if the scheduler and
        // manual trigger fire simultaneously.
        this.squareSyncDlq = new sqs.Queue(this, 'SquareSyncDlq', {
            queueName: `fcc-square-sync-dlq-${envName}.fifo`,
            fifo: true,
            contentBasedDeduplication: true,
            retentionPeriod: cdk.Duration.days(messageRetentionDays),
        });
        this.squareSyncQueue = new sqs.Queue(this, 'SquareSyncQueue', {
            queueName: `fcc-square-sync-${envName}.fifo`,
            fifo: true,
            contentBasedDeduplication: true,
            retentionPeriod: cdk.Duration.days(messageRetentionDays),
            visibilityTimeout: cdk.Duration.seconds(120), // 2 minutes for Square API pagination + DB updates
            deadLetterQueue: {
                queue: this.squareSyncDlq,
                maxReceiveCount,
            },
        });
        // ══════════════════════════════════════════════════════════════════════════
        // CloudWatch Alarms on DLQ Depth
        // ══════════════════════════════════════════════════════════════════════════
        //
        // Each DLQ gets a CloudWatch alarm that fires when ApproximateNumberOfMessagesVisible > 0.
        // This signals that messages have moved to the DLQ due to repeated processing
        // failures, requiring investigation by the operations team.
        //
        // Alarm threshold: > 0 messages (any message in a DLQ is a signal of failure)
        // Evaluation periods: 1 data point over 5 minutes (CloudWatch default granularity)
        // Treat missing data: NOT breaching (missing data means no messages in DLQ)
        this.costPropagationDlqAlarm = new cloudwatch.Alarm(this, 'CostPropagationDlqAlarm', {
            alarmName: `fcc-cost-propagation-dlq-alarm-${envName}`,
            alarmDescription: 'Alarm when cost propagation DLQ has messages (processing failures)',
            metric: this.costPropagationDlq.metricApproximateNumberOfMessagesVisible({
                period: cdk.Duration.minutes(5),
                statistic: cloudwatch.Stats.MAXIMUM,
            }),
            threshold: 0,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.ocrProcessingDlqAlarm = new cloudwatch.Alarm(this, 'OcrProcessingDlqAlarm', {
            alarmName: `fcc-ocr-processing-dlq-alarm-${envName}`,
            alarmDescription: 'Alarm when OCR processing DLQ has messages (Textract or parsing failures)',
            metric: this.ocrProcessingDlq.metricApproximateNumberOfMessagesVisible({
                period: cdk.Duration.minutes(5),
                statistic: cloudwatch.Stats.MAXIMUM,
            }),
            threshold: 0,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.aiInsightsDlqAlarm = new cloudwatch.Alarm(this, 'AiInsightsDlqAlarm', {
            alarmName: `fcc-ai-insights-dlq-alarm-${envName}`,
            alarmDescription: 'Alarm when AI insights DLQ has messages (Bedrock or analysis failures)',
            metric: this.aiInsightsDlq.metricApproximateNumberOfMessagesVisible({
                period: cdk.Duration.minutes(5),
                statistic: cloudwatch.Stats.MAXIMUM,
            }),
            threshold: 0,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        this.squareSyncDlqAlarm = new cloudwatch.Alarm(this, 'SquareSyncDlqAlarm', {
            alarmName: `fcc-square-sync-dlq-alarm-${envName}`,
            alarmDescription: 'Alarm when Square sync DLQ has messages (Square API or matching failures)',
            metric: this.squareSyncDlq.metricApproximateNumberOfMessagesVisible({
                period: cdk.Duration.minutes(5),
                statistic: cloudwatch.Stats.MAXIMUM,
            }),
            threshold: 0,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        // ── CloudFormation Outputs ───────────────────────────────────────────────
        // Exported so downstream stacks (worker service, API service) can import
        // queue URLs and ARNs without hard-coding.
        new cdk.CfnOutput(this, 'CostPropagationQueueUrl', {
            value: this.costPropagationQueue.queueUrl,
            description: 'Cost propagation queue URL',
            exportName: `FoodCostCalculator-${envName}-CostPropagationQueueUrl`,
        });
        new cdk.CfnOutput(this, 'CostPropagationQueueArn', {
            value: this.costPropagationQueue.queueArn,
            description: 'Cost propagation queue ARN',
            exportName: `FoodCostCalculator-${envName}-CostPropagationQueueArn`,
        });
        new cdk.CfnOutput(this, 'OcrProcessingQueueUrl', {
            value: this.ocrProcessingQueue.queueUrl,
            description: 'OCR processing queue URL',
            exportName: `FoodCostCalculator-${envName}-OcrProcessingQueueUrl`,
        });
        new cdk.CfnOutput(this, 'OcrProcessingQueueArn', {
            value: this.ocrProcessingQueue.queueArn,
            description: 'OCR processing queue ARN',
            exportName: `FoodCostCalculator-${envName}-OcrProcessingQueueArn`,
        });
        new cdk.CfnOutput(this, 'AiInsightsQueueUrl', {
            value: this.aiInsightsQueue.queueUrl,
            description: 'AI insights queue URL',
            exportName: `FoodCostCalculator-${envName}-AiInsightsQueueUrl`,
        });
        new cdk.CfnOutput(this, 'AiInsightsQueueArn', {
            value: this.aiInsightsQueue.queueArn,
            description: 'AI insights queue ARN',
            exportName: `FoodCostCalculator-${envName}-AiInsightsQueueArn`,
        });
        new cdk.CfnOutput(this, 'SquareSyncQueueUrl', {
            value: this.squareSyncQueue.queueUrl,
            description: 'Square sync queue URL',
            exportName: `FoodCostCalculator-${envName}-SquareSyncQueueUrl`,
        });
        new cdk.CfnOutput(this, 'SquareSyncQueueArn', {
            value: this.squareSyncQueue.queueArn,
            description: 'Square sync queue ARN',
            exportName: `FoodCostCalculator-${envName}-SquareSyncQueueArn`,
        });
        // DLQ outputs (for monitoring and operational dashboards)
        new cdk.CfnOutput(this, 'CostPropagationDlqUrl', {
            value: this.costPropagationDlq.queueUrl,
            description: 'Cost propagation DLQ URL',
            exportName: `FoodCostCalculator-${envName}-CostPropagationDlqUrl`,
        });
        new cdk.CfnOutput(this, 'OcrProcessingDlqUrl', {
            value: this.ocrProcessingDlq.queueUrl,
            description: 'OCR processing DLQ URL',
            exportName: `FoodCostCalculator-${envName}-OcrProcessingDlqUrl`,
        });
        new cdk.CfnOutput(this, 'AiInsightsDlqUrl', {
            value: this.aiInsightsDlq.queueUrl,
            description: 'AI insights DLQ URL',
            exportName: `FoodCostCalculator-${envName}-AiInsightsDlqUrl`,
        });
        new cdk.CfnOutput(this, 'SquareSyncDlqUrl', {
            value: this.squareSyncDlq.queueUrl,
            description: 'Square sync DLQ URL',
            exportName: `FoodCostCalculator-${envName}-SquareSyncDlqUrl`,
        });
        // CloudWatch Alarm ARNs (for SNS topic subscription in ObservabilityStack)
        new cdk.CfnOutput(this, 'CostPropagationDlqAlarmArn', {
            value: this.costPropagationDlqAlarm.alarmArn,
            description: 'Cost propagation DLQ alarm ARN',
            exportName: `FoodCostCalculator-${envName}-CostPropagationDlqAlarmArn`,
        });
        new cdk.CfnOutput(this, 'OcrProcessingDlqAlarmArn', {
            value: this.ocrProcessingDlqAlarm.alarmArn,
            description: 'OCR processing DLQ alarm ARN',
            exportName: `FoodCostCalculator-${envName}-OcrProcessingDlqAlarmArn`,
        });
        new cdk.CfnOutput(this, 'AiInsightsDlqAlarmArn', {
            value: this.aiInsightsDlqAlarm.alarmArn,
            description: 'AI insights DLQ alarm ARN',
            exportName: `FoodCostCalculator-${envName}-AiInsightsDlqAlarmArn`,
        });
        new cdk.CfnOutput(this, 'SquareSyncDlqAlarmArn', {
            value: this.squareSyncDlqAlarm.alarmArn,
            description: 'Square sync DLQ alarm ARN',
            exportName: `FoodCostCalculator-${envName}-SquareSyncDlqAlarmArn`,
        });
    }
}
exports.MessagingStack = MessagingStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTWVzc2FnaW5nU3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9saWIvc3RhY2tzL01lc3NhZ2luZ1N0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQywyQ0FBMkM7QUFDM0MseURBQXlEO0FBUXpEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXVCRztBQUNILE1BQWEsY0FBZSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzNDLGtHQUFrRztJQUNsRixvQkFBb0IsQ0FBWTtJQUVoRCw2RUFBNkU7SUFDN0Qsa0JBQWtCLENBQVk7SUFFOUMsa0ZBQWtGO0lBQ2xFLGVBQWUsQ0FBWTtJQUUzQyw2RUFBNkU7SUFDN0QsZUFBZSxDQUFZO0lBRTNDLHNEQUFzRDtJQUN0QyxrQkFBa0IsQ0FBWTtJQUU5QyxvREFBb0Q7SUFDcEMsZ0JBQWdCLENBQVk7SUFFNUMsNERBQTREO0lBQzVDLGFBQWEsQ0FBWTtJQUV6QyxpREFBaUQ7SUFDakMsYUFBYSxDQUFZO0lBRXpDLHNEQUFzRDtJQUN0Qyx1QkFBdUIsQ0FBbUI7SUFFMUQsb0RBQW9EO0lBQ3BDLHFCQUFxQixDQUFtQjtJQUV4RCxpREFBaUQ7SUFDakMsa0JBQWtCLENBQW1CO0lBRXJELGlEQUFpRDtJQUNqQyxrQkFBa0IsQ0FBbUI7SUFFckQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUEwQjtRQUNsRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTFCLDRFQUE0RTtRQUM1RSxNQUFNLG9CQUFvQixHQUFHLEVBQUUsQ0FBQztRQUNoQyxNQUFNLGVBQWUsR0FBRyxDQUFDLENBQUMsQ0FBQyxzQ0FBc0M7UUFFakUsNkVBQTZFO1FBQzdFLDRCQUE0QjtRQUM1Qiw2RUFBNkU7UUFDN0UsRUFBRTtRQUNGLFdBQVc7UUFDWCwrRUFBK0U7UUFDL0Usa0ZBQWtGO1FBQ2xGLDREQUE0RDtRQUM1RCxFQUFFO1FBQ0YsbUVBQW1FO1FBQ25FLEVBQUU7UUFDRiwrRUFBK0U7UUFDL0UsOEVBQThFO1FBQzlFLDRDQUE0QztRQUU1QyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUNsRSxTQUFTLEVBQUUsNEJBQTRCLE9BQU8sT0FBTztZQUNyRCxJQUFJLEVBQUUsSUFBSTtZQUNWLHlCQUF5QixFQUFFLElBQUk7WUFDL0IsZUFBZSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLG9CQUFvQixDQUFDO1NBQ3pELENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxvQkFBb0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFFO1lBQ3RFLFNBQVMsRUFBRSx3QkFBd0IsT0FBTyxPQUFPO1lBQ2pELElBQUksRUFBRSxJQUFJO1lBQ1YseUJBQXlCLEVBQUUsSUFBSTtZQUMvQixlQUFlLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsb0JBQW9CLENBQUM7WUFDeEQsaUJBQWlCLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEVBQUUsb0NBQW9DO1lBQ2pGLGVBQWUsRUFBRTtnQkFDZixLQUFLLEVBQUUsSUFBSSxDQUFDLGtCQUFrQjtnQkFDOUIsZUFBZTthQUNoQjtTQUNGLENBQUMsQ0FBQztRQUVILDZFQUE2RTtRQUM3RSwwQkFBMEI7UUFDMUIsNkVBQTZFO1FBQzdFLEVBQUU7UUFDRixXQUFXO1FBQ1gsNEVBQTRFO1FBQzVFLG1GQUFtRjtRQUNuRiwwREFBMEQ7UUFDMUQsRUFBRTtRQUNGLDhFQUE4RTtRQUM5RSxFQUFFO1FBQ0YsMkVBQTJFO1FBQzNFLDJFQUEyRTtRQUMzRSxzREFBc0Q7UUFFdEQsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDOUQsU0FBUyxFQUFFLDBCQUEwQixPQUFPLE9BQU87WUFDbkQsSUFBSSxFQUFFLElBQUk7WUFDVix5QkFBeUIsRUFBRSxJQUFJO1lBQy9CLGVBQWUsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQztTQUN6RCxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsa0JBQWtCLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUNsRSxTQUFTLEVBQUUsc0JBQXNCLE9BQU8sT0FBTztZQUMvQyxJQUFJLEVBQUUsSUFBSTtZQUNWLHlCQUF5QixFQUFFLElBQUk7WUFDL0IsZUFBZSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLG9CQUFvQixDQUFDO1lBQ3hELGlCQUFpQixFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxFQUFFLDZDQUE2QztZQUMxRixlQUFlLEVBQUU7Z0JBQ2YsS0FBSyxFQUFFLElBQUksQ0FBQyxnQkFBZ0I7Z0JBQzVCLGVBQWU7YUFDaEI7U0FDRixDQUFDLENBQUM7UUFFSCw2RUFBNkU7UUFDN0UsdUJBQXVCO1FBQ3ZCLDZFQUE2RTtRQUM3RSxFQUFFO1FBQ0YsV0FBVztRQUNYLDRFQUE0RTtRQUM1RSw2RUFBNkU7UUFDN0UsOERBQThEO1FBQzlELEVBQUU7UUFDRix3RUFBd0U7UUFDeEUsRUFBRTtRQUNGLHVFQUF1RTtRQUN2RSx3RUFBd0U7UUFDeEUsNERBQTREO1FBRTVELElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDeEQsU0FBUyxFQUFFLHVCQUF1QixPQUFPLE9BQU87WUFDaEQsSUFBSSxFQUFFLElBQUk7WUFDVix5QkFBeUIsRUFBRSxJQUFJO1lBQy9CLGVBQWUsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQztTQUN6RCxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDNUQsU0FBUyxFQUFFLG1CQUFtQixPQUFPLE9BQU87WUFDNUMsSUFBSSxFQUFFLElBQUk7WUFDVix5QkFBeUIsRUFBRSxJQUFJO1lBQy9CLGVBQWUsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQztZQUN4RCxpQkFBaUIsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSw0Q0FBNEM7WUFDeEYsZUFBZSxFQUFFO2dCQUNmLEtBQUssRUFBRSxJQUFJLENBQUMsYUFBYTtnQkFDekIsZUFBZTthQUNoQjtTQUNGLENBQUMsQ0FBQztRQUVILDZFQUE2RTtRQUM3RSx1QkFBdUI7UUFDdkIsNkVBQTZFO1FBQzdFLEVBQUU7UUFDRixXQUFXO1FBQ1gsNkVBQTZFO1FBQzdFLDhFQUE4RTtRQUM5RSwyRUFBMkU7UUFDM0UsaUNBQWlDO1FBQ2pDLEVBQUU7UUFDRiw2REFBNkQ7UUFDN0QsRUFBRTtRQUNGLG9FQUFvRTtRQUNwRSw0RUFBNEU7UUFDNUUsc0NBQXNDO1FBRXRDLElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDeEQsU0FBUyxFQUFFLHVCQUF1QixPQUFPLE9BQU87WUFDaEQsSUFBSSxFQUFFLElBQUk7WUFDVix5QkFBeUIsRUFBRSxJQUFJO1lBQy9CLGVBQWUsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQztTQUN6RCxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDNUQsU0FBUyxFQUFFLG1CQUFtQixPQUFPLE9BQU87WUFDNUMsSUFBSSxFQUFFLElBQUk7WUFDVix5QkFBeUIsRUFBRSxJQUFJO1lBQy9CLGVBQWUsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQztZQUN4RCxpQkFBaUIsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRSxtREFBbUQ7WUFDakcsZUFBZSxFQUFFO2dCQUNmLEtBQUssRUFBRSxJQUFJLENBQUMsYUFBYTtnQkFDekIsZUFBZTthQUNoQjtTQUNGLENBQUMsQ0FBQztRQUVILDZFQUE2RTtRQUM3RSxpQ0FBaUM7UUFDakMsNkVBQTZFO1FBQzdFLEVBQUU7UUFDRiwyRkFBMkY7UUFDM0YsOEVBQThFO1FBQzlFLDREQUE0RDtRQUM1RCxFQUFFO1FBQ0YsOEVBQThFO1FBQzlFLG1GQUFtRjtRQUNuRiw0RUFBNEU7UUFFNUUsSUFBSSxDQUFDLHVCQUF1QixHQUFHLElBQUksVUFBVSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUseUJBQXlCLEVBQUU7WUFDbkYsU0FBUyxFQUFFLGtDQUFrQyxPQUFPLEVBQUU7WUFDdEQsZ0JBQWdCLEVBQUUsb0VBQW9FO1lBQ3RGLE1BQU0sRUFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsd0NBQXdDLENBQUM7Z0JBQ3ZFLE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7Z0JBQy9CLFNBQVMsRUFBRSxVQUFVLENBQUMsS0FBSyxDQUFDLE9BQU87YUFDcEMsQ0FBQztZQUNGLFNBQVMsRUFBRSxDQUFDO1lBQ1osa0JBQWtCLEVBQUUsVUFBVSxDQUFDLGtCQUFrQixDQUFDLHNCQUFzQjtZQUN4RSxpQkFBaUIsRUFBRSxDQUFDO1lBQ3BCLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhO1NBQzVELENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxxQkFBcUIsR0FBRyxJQUFJLFVBQVUsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLHVCQUF1QixFQUFFO1lBQy9FLFNBQVMsRUFBRSxnQ0FBZ0MsT0FBTyxFQUFFO1lBQ3BELGdCQUFnQixFQUFFLDJFQUEyRTtZQUM3RixNQUFNLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLHdDQUF3QyxDQUFDO2dCQUNyRSxNQUFNLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO2dCQUMvQixTQUFTLEVBQUUsVUFBVSxDQUFDLEtBQUssQ0FBQyxPQUFPO2FBQ3BDLENBQUM7WUFDRixTQUFTLEVBQUUsQ0FBQztZQUNaLGtCQUFrQixFQUFFLFVBQVUsQ0FBQyxrQkFBa0IsQ0FBQyxzQkFBc0I7WUFDeEUsaUJBQWlCLEVBQUUsQ0FBQztZQUNwQixnQkFBZ0IsRUFBRSxVQUFVLENBQUMsZ0JBQWdCLENBQUMsYUFBYTtTQUM1RCxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsa0JBQWtCLEdBQUcsSUFBSSxVQUFVLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUN6RSxTQUFTLEVBQUUsNkJBQTZCLE9BQU8sRUFBRTtZQUNqRCxnQkFBZ0IsRUFBRSx3RUFBd0U7WUFDMUYsTUFBTSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsd0NBQXdDLENBQUM7Z0JBQ2xFLE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7Z0JBQy9CLFNBQVMsRUFBRSxVQUFVLENBQUMsS0FBSyxDQUFDLE9BQU87YUFDcEMsQ0FBQztZQUNGLFNBQVMsRUFBRSxDQUFDO1lBQ1osa0JBQWtCLEVBQUUsVUFBVSxDQUFDLGtCQUFrQixDQUFDLHNCQUFzQjtZQUN4RSxpQkFBaUIsRUFBRSxDQUFDO1lBQ3BCLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhO1NBQzVELENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLFVBQVUsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQ3pFLFNBQVMsRUFBRSw2QkFBNkIsT0FBTyxFQUFFO1lBQ2pELGdCQUFnQixFQUFFLDJFQUEyRTtZQUM3RixNQUFNLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyx3Q0FBd0MsQ0FBQztnQkFDbEUsTUFBTSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztnQkFDL0IsU0FBUyxFQUFFLFVBQVUsQ0FBQyxLQUFLLENBQUMsT0FBTzthQUNwQyxDQUFDO1lBQ0YsU0FBUyxFQUFFLENBQUM7WUFDWixrQkFBa0IsRUFBRSxVQUFVLENBQUMsa0JBQWtCLENBQUMsc0JBQXNCO1lBQ3hFLGlCQUFpQixFQUFFLENBQUM7WUFDcEIsZ0JBQWdCLEVBQUUsVUFBVSxDQUFDLGdCQUFnQixDQUFDLGFBQWE7U0FDNUQsQ0FBQyxDQUFDO1FBRUgsNEVBQTRFO1FBQzVFLHlFQUF5RTtRQUN6RSwyQ0FBMkM7UUFFM0MsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSx5QkFBeUIsRUFBRTtZQUNqRCxLQUFLLEVBQUUsSUFBSSxDQUFDLG9CQUFvQixDQUFDLFFBQVE7WUFDekMsV0FBVyxFQUFFLDRCQUE0QjtZQUN6QyxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sMEJBQTBCO1NBQ3BFLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUseUJBQXlCLEVBQUU7WUFDakQsS0FBSyxFQUFFLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxRQUFRO1lBQ3pDLFdBQVcsRUFBRSw0QkFBNEI7WUFDekMsVUFBVSxFQUFFLHNCQUFzQixPQUFPLDBCQUEwQjtTQUNwRSxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHVCQUF1QixFQUFFO1lBQy9DLEtBQUssRUFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsUUFBUTtZQUN2QyxXQUFXLEVBQUUsMEJBQTBCO1lBQ3ZDLFVBQVUsRUFBRSxzQkFBc0IsT0FBTyx3QkFBd0I7U0FDbEUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUMvQyxLQUFLLEVBQUUsSUFBSSxDQUFDLGtCQUFrQixDQUFDLFFBQVE7WUFDdkMsV0FBVyxFQUFFLDBCQUEwQjtZQUN2QyxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sd0JBQXdCO1NBQ2xFLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDNUMsS0FBSyxFQUFFLElBQUksQ0FBQyxlQUFlLENBQUMsUUFBUTtZQUNwQyxXQUFXLEVBQUUsdUJBQXVCO1lBQ3BDLFVBQVUsRUFBRSxzQkFBc0IsT0FBTyxxQkFBcUI7U0FDL0QsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUM1QyxLQUFLLEVBQUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxRQUFRO1lBQ3BDLFdBQVcsRUFBRSx1QkFBdUI7WUFDcEMsVUFBVSxFQUFFLHNCQUFzQixPQUFPLHFCQUFxQjtTQUMvRCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQzVDLEtBQUssRUFBRSxJQUFJLENBQUMsZUFBZSxDQUFDLFFBQVE7WUFDcEMsV0FBVyxFQUFFLHVCQUF1QjtZQUNwQyxVQUFVLEVBQUUsc0JBQXNCLE9BQU8scUJBQXFCO1NBQy9ELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDNUMsS0FBSyxFQUFFLElBQUksQ0FBQyxlQUFlLENBQUMsUUFBUTtZQUNwQyxXQUFXLEVBQUUsdUJBQXVCO1lBQ3BDLFVBQVUsRUFBRSxzQkFBc0IsT0FBTyxxQkFBcUI7U0FDL0QsQ0FBQyxDQUFDO1FBRUgsMERBQTBEO1FBRTFELElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDL0MsS0FBSyxFQUFFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxRQUFRO1lBQ3ZDLFdBQVcsRUFBRSwwQkFBMEI7WUFDdkMsVUFBVSxFQUFFLHNCQUFzQixPQUFPLHdCQUF3QjtTQUNsRSxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQzdDLEtBQUssRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsUUFBUTtZQUNyQyxXQUFXLEVBQUUsd0JBQXdCO1lBQ3JDLFVBQVUsRUFBRSxzQkFBc0IsT0FBTyxzQkFBc0I7U0FDaEUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRO1lBQ2xDLFdBQVcsRUFBRSxxQkFBcUI7WUFDbEMsVUFBVSxFQUFFLHNCQUFzQixPQUFPLG1CQUFtQjtTQUM3RCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzFDLEtBQUssRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVE7WUFDbEMsV0FBVyxFQUFFLHFCQUFxQjtZQUNsQyxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sbUJBQW1CO1NBQzdELENBQUMsQ0FBQztRQUVILDJFQUEyRTtRQUUzRSxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLDRCQUE0QixFQUFFO1lBQ3BELEtBQUssRUFBRSxJQUFJLENBQUMsdUJBQXVCLENBQUMsUUFBUTtZQUM1QyxXQUFXLEVBQUUsZ0NBQWdDO1lBQzdDLFVBQVUsRUFBRSxzQkFBc0IsT0FBTyw2QkFBNkI7U0FDdkUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSwwQkFBMEIsRUFBRTtZQUNsRCxLQUFLLEVBQUUsSUFBSSxDQUFDLHFCQUFxQixDQUFDLFFBQVE7WUFDMUMsV0FBVyxFQUFFLDhCQUE4QjtZQUMzQyxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sMkJBQTJCO1NBQ3JFLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDL0MsS0FBSyxFQUFFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxRQUFRO1lBQ3ZDLFdBQVcsRUFBRSwyQkFBMkI7WUFDeEMsVUFBVSxFQUFFLHNCQUFzQixPQUFPLHdCQUF3QjtTQUNsRSxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHVCQUF1QixFQUFFO1lBQy9DLEtBQUssRUFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsUUFBUTtZQUN2QyxXQUFXLEVBQUUsMkJBQTJCO1lBQ3hDLFVBQVUsRUFBRSxzQkFBc0IsT0FBTyx3QkFBd0I7U0FDbEUsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBL1ZELHdDQStWQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBzcXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNxcyc7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIE1lc3NhZ2luZ1N0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIC8qKiBMb2dpY2FsIGVudmlyb25tZW50IG5hbWUsIGUuZy4gXCJzdGFnaW5nXCIgb3IgXCJwcm9kXCIuIFVzZWQgZm9yIG5hbWluZy4gKi9cbiAgcmVhZG9ubHkgZW52TmFtZTogc3RyaW5nO1xufVxuXG4vKipcbiAqIE1lc3NhZ2luZ1N0YWNrXG4gKlxuICogUHJvdmlzaW9ucyB0aGUgYXN5bmNocm9ub3VzIG1lc3NhZ2luZyBpbmZyYXN0cnVjdHVyZSBmb3IgdGhlIEZvb2QgQ29zdCBDYWxjdWxhdG9yOlxuICpcbiAqICDigKIgRm91ciBGSUZPIHF1ZXVlcyB3aXRoIGNvbnRlbnQtYmFzZWQgZGVkdXBsaWNhdGlvbjpcbiAqICAgIC0gY29zdC1wcm9wYWdhdGlvbi5maWZvICAg4oCUIHRyaWdnZXJzIHJlY2lwZSBjb3N0IHJlY2FsY3VsYXRpb24gd2hlbiBpbmdyZWRpZW50IHByaWNlcyBjaGFuZ2VcbiAqICAgIC0gb2NyLXByb2Nlc3NpbmcuZmlmbyAgICAg4oCUIHByb2Nlc3NlcyBzdXBwbGllciBpbnZvaWNlIHVwbG9hZHMgdmlhIEFXUyBUZXh0cmFjdFxuICogICAgLSBhaS1pbnNpZ2h0cy5maWZvICAgICAgICDigJQgZ2VuZXJhdGVzIEFJLWRyaXZlbiBwcm9maXRhYmlsaXR5IGFuZCBzdXBwbGllciBpbnNpZ2h0c1xuICogICAgLSBzcXVhcmUtc3luYy5maWZvICAgICAgICDigJQgc3luY2hyb25pemVzIG1lbnUgaXRlbSBzYWxlcyBkYXRhIGZyb20gU3F1YXJlIFBPUyBBUElcbiAqXG4gKiAg4oCiIERlYWQtbGV0dGVyIHF1ZXVlcyAoRExRKSBmb3IgZWFjaCBtYWluIHF1ZXVlOlxuICogICAgLSBtYXhSZWNlaXZlQ291bnQgPSAzICAgIOKAlCBtZXNzYWdlcyBtb3ZlIHRvIERMUSBhZnRlciAzIGZhaWxlZCBwcm9jZXNzaW5nIGF0dGVtcHRzXG4gKiAgICAtIDE0LWRheSByZXRlbnRpb24gICAgICAg4oCUIG1hdGNoZXMgbWFpbiBxdWV1ZSByZXRlbnRpb24gZm9yIGF1ZGl0IGFuZCByZXBsYXlcbiAqXG4gKiAg4oCiIENsb3VkV2F0Y2ggYWxhcm1zIG9uIERMUSBkZXB0aDpcbiAqICAgIC0gQWxhcm0gZmlyZXMgd2hlbiBhbnkgRExRIGRlcHRoID4gMCAoc2lnbmFscyBwcm9jZXNzaW5nIGZhaWx1cmVzIHJlcXVpcmluZyBpbnZlc3RpZ2F0aW9uKVxuICogICAgLSBBbGFybXMgYXJlIGNyZWF0ZWQgZm9yIGVhY2ggRExRIHNlcGFyYXRlbHkgZm9yIGdyYW51bGFyIGFsZXJ0aW5nXG4gKlxuICogU2F0aXNmaWVzIFJlcXVpcmVtZW50czpcbiAqICAtIDMuMzogIENvc3QgcHJvcGFnYXRpb24gd2l0aGluIDIgc2Vjb25kcyBvZiBpbmdyZWRpZW50IHByaWNlIHVwZGF0ZVxuICogIC0gMTIuNzogT0NSIHByb2Nlc3Npbmcgd2l0aGluIDMwIHNlY29uZHMgb2YgaW52b2ljZSB1cGxvYWRcbiAqICAtIDEzLjQ6IEFJIGluc2lnaHRzIHJlZnJlc2ggd2l0aGluIDI0IGhvdXJzIG9mIG5ldyBkYXRhXG4gKi9cbmV4cG9ydCBjbGFzcyBNZXNzYWdpbmdTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIC8qKiBDb3N0IHByb3BhZ2F0aW9uIHF1ZXVlIOKAlCB1c2VkIHdoZW4gaW5ncmVkaWVudCBwcmljZXMgY2hhbmdlIHRvIHRyaWdnZXIgcmVjaXBlIHJlY2FsY3VsYXRpb24gKi9cbiAgcHVibGljIHJlYWRvbmx5IGNvc3RQcm9wYWdhdGlvblF1ZXVlOiBzcXMuUXVldWU7XG5cbiAgLyoqIE9DUiBwcm9jZXNzaW5nIHF1ZXVlIOKAlCB1c2VkIGZvciBpbnZvaWNlIHVwbG9hZCBhbmQgVGV4dHJhY3QgZXh0cmFjdGlvbiAqL1xuICBwdWJsaWMgcmVhZG9ubHkgb2NyUHJvY2Vzc2luZ1F1ZXVlOiBzcXMuUXVldWU7XG5cbiAgLyoqIEFJIGluc2lnaHRzIHF1ZXVlIOKAlCB1c2VkIGZvciBnZW5lcmF0aW5nIHByb2ZpdGFiaWxpdHkgYW5kIHN1cHBsaWVyIGluc2lnaHRzICovXG4gIHB1YmxpYyByZWFkb25seSBhaUluc2lnaHRzUXVldWU6IHNxcy5RdWV1ZTtcblxuICAvKiogU3F1YXJlIHN5bmMgcXVldWUg4oCUIHVzZWQgZm9yIHBvbGxpbmcgYW5kIHN5bmNpbmcgU3F1YXJlIFBPUyBzYWxlcyBkYXRhICovXG4gIHB1YmxpYyByZWFkb25seSBzcXVhcmVTeW5jUXVldWU6IHNxcy5RdWV1ZTtcblxuICAvKiogRGVhZC1sZXR0ZXIgcXVldWUgZm9yIGNvc3QgcHJvcGFnYXRpb24gZmFpbHVyZXMgKi9cbiAgcHVibGljIHJlYWRvbmx5IGNvc3RQcm9wYWdhdGlvbkRscTogc3FzLlF1ZXVlO1xuXG4gIC8qKiBEZWFkLWxldHRlciBxdWV1ZSBmb3IgT0NSIHByb2Nlc3NpbmcgZmFpbHVyZXMgKi9cbiAgcHVibGljIHJlYWRvbmx5IG9jclByb2Nlc3NpbmdEbHE6IHNxcy5RdWV1ZTtcblxuICAvKiogRGVhZC1sZXR0ZXIgcXVldWUgZm9yIEFJIGluc2lnaHRzIGdlbmVyYXRpb24gZmFpbHVyZXMgKi9cbiAgcHVibGljIHJlYWRvbmx5IGFpSW5zaWdodHNEbHE6IHNxcy5RdWV1ZTtcblxuICAvKiogRGVhZC1sZXR0ZXIgcXVldWUgZm9yIFNxdWFyZSBzeW5jIGZhaWx1cmVzICovXG4gIHB1YmxpYyByZWFkb25seSBzcXVhcmVTeW5jRGxxOiBzcXMuUXVldWU7XG5cbiAgLyoqIENsb3VkV2F0Y2ggYWxhcm0gZm9yIGNvc3QgcHJvcGFnYXRpb24gRExRIGRlcHRoICovXG4gIHB1YmxpYyByZWFkb25seSBjb3N0UHJvcGFnYXRpb25EbHFBbGFybTogY2xvdWR3YXRjaC5BbGFybTtcblxuICAvKiogQ2xvdWRXYXRjaCBhbGFybSBmb3IgT0NSIHByb2Nlc3NpbmcgRExRIGRlcHRoICovXG4gIHB1YmxpYyByZWFkb25seSBvY3JQcm9jZXNzaW5nRGxxQWxhcm06IGNsb3Vkd2F0Y2guQWxhcm07XG5cbiAgLyoqIENsb3VkV2F0Y2ggYWxhcm0gZm9yIEFJIGluc2lnaHRzIERMUSBkZXB0aCAqL1xuICBwdWJsaWMgcmVhZG9ubHkgYWlJbnNpZ2h0c0RscUFsYXJtOiBjbG91ZHdhdGNoLkFsYXJtO1xuXG4gIC8qKiBDbG91ZFdhdGNoIGFsYXJtIGZvciBTcXVhcmUgc3luYyBETFEgZGVwdGggKi9cbiAgcHVibGljIHJlYWRvbmx5IHNxdWFyZVN5bmNEbHFBbGFybTogY2xvdWR3YXRjaC5BbGFybTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogTWVzc2FnaW5nU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBlbnZOYW1lIH0gPSBwcm9wcztcblxuICAgIC8vIOKUgOKUgCBSZXRlbnRpb24gYW5kIERMUSBDb25maWd1cmF0aW9uIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIGNvbnN0IG1lc3NhZ2VSZXRlbnRpb25EYXlzID0gMTQ7XG4gICAgY29uc3QgbWF4UmVjZWl2ZUNvdW50ID0gMzsgLy8gTW92ZSB0byBETFEgYWZ0ZXIgMyBmYWlsZWQgYXR0ZW1wdHNcblxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIDEuIENvc3QgUHJvcGFnYXRpb24gUXVldWVcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAvL1xuICAgIC8vIFB1cnBvc2U6XG4gICAgLy8gICBUcmlnZ2VyZWQgd2hlbiBhbiBpbmdyZWRpZW50J3MgcHVyY2hhc2UgcHJpY2UsIHB1cmNoYXNlIHF1YW50aXR5LCBvciB5aWVsZFxuICAgIC8vICAgcGVyY2VudGFnZSBjaGFuZ2VzLiBXb3JrZXIgcmVjYWxjdWxhdGVzIGZvb2QgY29zdCBwZXIgcG9ydGlvbiBmb3IgYWxsIHJlY2lwZXNcbiAgICAvLyAgIHRoYXQgZGlyZWN0bHkgb3IgdHJhbnNpdGl2ZWx5IHJlZmVyZW5jZSB0aGUgaW5ncmVkaWVudC5cbiAgICAvL1xuICAgIC8vIFNMQSAoUmVxdWlyZW1lbnQgMy4zKTogUmVjYWxjdWxhdGlvbiB3aXRoaW4gMiBzZWNvbmRzIG9mIHVwZGF0ZS5cbiAgICAvL1xuICAgIC8vIEZJRk8gZ3VhcmFudGVlcyBvcmRlci1wcmVzZXJ2aW5nIHByb2Nlc3NpbmcgZm9yIG11bHRpcGxlIHVwZGF0ZXMgdG8gdGhlIHNhbWVcbiAgICAvLyBpbmdyZWRpZW50LiBDb250ZW50LWJhc2VkIGRlZHVwbGljYXRpb24gcHJldmVudHMgZHVwbGljYXRlIHByb3BhZ2F0aW9uIGpvYnNcbiAgICAvLyB3aXRoaW4gdGhlIDUtbWludXRlIGRlZHVwbGljYXRpb24gd2luZG93LlxuXG4gICAgdGhpcy5jb3N0UHJvcGFnYXRpb25EbHEgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdDb3N0UHJvcGFnYXRpb25EbHEnLCB7XG4gICAgICBxdWV1ZU5hbWU6IGBmY2MtY29zdC1wcm9wYWdhdGlvbi1kbHEtJHtlbnZOYW1lfS5maWZvYCxcbiAgICAgIGZpZm86IHRydWUsXG4gICAgICBjb250ZW50QmFzZWREZWR1cGxpY2F0aW9uOiB0cnVlLFxuICAgICAgcmV0ZW50aW9uUGVyaW9kOiBjZGsuRHVyYXRpb24uZGF5cyhtZXNzYWdlUmV0ZW50aW9uRGF5cyksXG4gICAgfSk7XG5cbiAgICB0aGlzLmNvc3RQcm9wYWdhdGlvblF1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCAnQ29zdFByb3BhZ2F0aW9uUXVldWUnLCB7XG4gICAgICBxdWV1ZU5hbWU6IGBmY2MtY29zdC1wcm9wYWdhdGlvbi0ke2Vudk5hbWV9LmZpZm9gLFxuICAgICAgZmlmbzogdHJ1ZSxcbiAgICAgIGNvbnRlbnRCYXNlZERlZHVwbGljYXRpb246IHRydWUsXG4gICAgICByZXRlbnRpb25QZXJpb2Q6IGNkay5EdXJhdGlvbi5kYXlzKG1lc3NhZ2VSZXRlbnRpb25EYXlzKSxcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksIC8vIDMwIHNlY29uZHMgdG8gcHJvY2VzcyBwcm9wYWdhdGlvblxuICAgICAgZGVhZExldHRlclF1ZXVlOiB7XG4gICAgICAgIHF1ZXVlOiB0aGlzLmNvc3RQcm9wYWdhdGlvbkRscSxcbiAgICAgICAgbWF4UmVjZWl2ZUNvdW50LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIDIuIE9DUiBQcm9jZXNzaW5nIFF1ZXVlXG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgLy9cbiAgICAvLyBQdXJwb3NlOlxuICAgIC8vICAgVHJpZ2dlcmVkIHdoZW4gYSB1c2VyIHVwbG9hZHMgYSBzdXBwbGllciBpbnZvaWNlIChQREYgb3IgaW1hZ2UpLiBXb3JrZXJcbiAgICAvLyAgIGNhbGxzIEFXUyBUZXh0cmFjdCB0byBleHRyYWN0IGluZ3JlZGllbnQgbmFtZXMsIHF1YW50aXRpZXMsIHVuaXRzLCBhbmQgcHJpY2VzLFxuICAgIC8vICAgdGhlbiBzdG9yZXMgdGhlIGV4dHJhY3RlZCBsaW5lIGl0ZW1zIGZvciB1c2VyIHJldmlldy5cbiAgICAvL1xuICAgIC8vIFNMQSAoUmVxdWlyZW1lbnQgMTIuNyk6IEV4dHJhY3Rpb24gYW5kIGRpc3BsYXkgd2l0aGluIDMwIHNlY29uZHMgb2YgdXBsb2FkLlxuICAgIC8vXG4gICAgLy8gRklGTyBlbnN1cmVzIGludm9pY2VzIGZyb20gdGhlIHNhbWUgdmVudWUgYXJlIHByb2Nlc3NlZCBpbiB1cGxvYWQgb3JkZXIuXG4gICAgLy8gQ29udGVudC1iYXNlZCBkZWR1cGxpY2F0aW9uIHByZXZlbnRzIHJlLXByb2Nlc3NpbmcgdGhlIHNhbWUgaW52b2ljZSBmaWxlXG4gICAgLy8gaWYgdGhlIHVzZXIgYWNjaWRlbnRhbGx5IHRyaWdnZXJzIG11bHRpcGxlIHVwbG9hZHMuXG5cbiAgICB0aGlzLm9jclByb2Nlc3NpbmdEbHEgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdPY3JQcm9jZXNzaW5nRGxxJywge1xuICAgICAgcXVldWVOYW1lOiBgZmNjLW9jci1wcm9jZXNzaW5nLWRscS0ke2Vudk5hbWV9LmZpZm9gLFxuICAgICAgZmlmbzogdHJ1ZSxcbiAgICAgIGNvbnRlbnRCYXNlZERlZHVwbGljYXRpb246IHRydWUsXG4gICAgICByZXRlbnRpb25QZXJpb2Q6IGNkay5EdXJhdGlvbi5kYXlzKG1lc3NhZ2VSZXRlbnRpb25EYXlzKSxcbiAgICB9KTtcblxuICAgIHRoaXMub2NyUHJvY2Vzc2luZ1F1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCAnT2NyUHJvY2Vzc2luZ1F1ZXVlJywge1xuICAgICAgcXVldWVOYW1lOiBgZmNjLW9jci1wcm9jZXNzaW5nLSR7ZW52TmFtZX0uZmlmb2AsXG4gICAgICBmaWZvOiB0cnVlLFxuICAgICAgY29udGVudEJhc2VkRGVkdXBsaWNhdGlvbjogdHJ1ZSxcbiAgICAgIHJldGVudGlvblBlcmlvZDogY2RrLkR1cmF0aW9uLmRheXMobWVzc2FnZVJldGVudGlvbkRheXMpLFxuICAgICAgdmlzaWJpbGl0eVRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwKSwgLy8gNjAgc2Vjb25kcyBmb3IgVGV4dHJhY3QgQVBJIGNhbGwgKyBwYXJzaW5nXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHtcbiAgICAgICAgcXVldWU6IHRoaXMub2NyUHJvY2Vzc2luZ0RscSxcbiAgICAgICAgbWF4UmVjZWl2ZUNvdW50LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIDMuIEFJIEluc2lnaHRzIFF1ZXVlXG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgLy9cbiAgICAvLyBQdXJwb3NlOlxuICAgIC8vICAgVHJpZ2dlcmVkIHdoZW4gbmV3IHNhbGVzIGRhdGEgaXMgc3luY2VkIGZyb20gU3F1YXJlIG9yIG5ldyBpbnZvaWNlIGRhdGFcbiAgICAvLyAgIGlzIGNvbmZpcm1lZC4gV29ya2VyIGNhbGxzIEFtYXpvbiBCZWRyb2NrIChBbnRocm9waWMgQ2xhdWRlKSB0byBnZW5lcmF0ZVxuICAgIC8vICAgcmVjaXBlIHByb2ZpdGFiaWxpdHkgaW5zaWdodHMgYW5kIHN1cHBsaWVyIGNvc3QgaW5zaWdodHMuXG4gICAgLy9cbiAgICAvLyBTTEEgKFJlcXVpcmVtZW50IDEzLjQpOiBJbnNpZ2h0cyByZWZyZXNoIHdpdGhpbiAyNCBob3VycyBvZiBuZXcgZGF0YS5cbiAgICAvL1xuICAgIC8vIEZJRk8gZW5zdXJlcyBpbnNpZ2h0cyBmb3IgdGhlIHNhbWUgdmVudWUgYXJlIGdlbmVyYXRlZCBzZXF1ZW50aWFsbHkuXG4gICAgLy8gQ29udGVudC1iYXNlZCBkZWR1cGxpY2F0aW9uIHByZXZlbnRzIHJlZHVuZGFudCBpbnNpZ2h0IGdlbmVyYXRpb24gZm9yXG4gICAgLy8gZHVwbGljYXRlIHRyaWdnZXIgZXZlbnRzIHdpdGhpbiB0aGUgZGVkdXBsaWNhdGlvbiB3aW5kb3cuXG5cbiAgICB0aGlzLmFpSW5zaWdodHNEbHEgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdBaUluc2lnaHRzRGxxJywge1xuICAgICAgcXVldWVOYW1lOiBgZmNjLWFpLWluc2lnaHRzLWRscS0ke2Vudk5hbWV9LmZpZm9gLFxuICAgICAgZmlmbzogdHJ1ZSxcbiAgICAgIGNvbnRlbnRCYXNlZERlZHVwbGljYXRpb246IHRydWUsXG4gICAgICByZXRlbnRpb25QZXJpb2Q6IGNkay5EdXJhdGlvbi5kYXlzKG1lc3NhZ2VSZXRlbnRpb25EYXlzKSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWlJbnNpZ2h0c1F1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCAnQWlJbnNpZ2h0c1F1ZXVlJywge1xuICAgICAgcXVldWVOYW1lOiBgZmNjLWFpLWluc2lnaHRzLSR7ZW52TmFtZX0uZmlmb2AsXG4gICAgICBmaWZvOiB0cnVlLFxuICAgICAgY29udGVudEJhc2VkRGVkdXBsaWNhdGlvbjogdHJ1ZSxcbiAgICAgIHJldGVudGlvblBlcmlvZDogY2RrLkR1cmF0aW9uLmRheXMobWVzc2FnZVJldGVudGlvbkRheXMpLFxuICAgICAgdmlzaWJpbGl0eVRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLCAvLyA1IG1pbnV0ZXMgZm9yIEJlZHJvY2sgQVBJIGNhbGwgKyBhbmFseXNpc1xuICAgICAgZGVhZExldHRlclF1ZXVlOiB7XG4gICAgICAgIHF1ZXVlOiB0aGlzLmFpSW5zaWdodHNEbHEsXG4gICAgICAgIG1heFJlY2VpdmVDb3VudCxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAvLyA0LiBTcXVhcmUgU3luYyBRdWV1ZVxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vXG4gICAgLy8gUHVycG9zZTpcbiAgICAvLyAgIFRyaWdnZXJlZCBvbiBhIHNjaGVkdWxlIChhdCBsZWFzdCBvbmNlIGV2ZXJ5IDI0IGhvdXJzKSBvciBvbi1kZW1hbmQgd2hlblxuICAgIC8vICAgdGhlIHVzZXIgdHJpZ2dlcnMgYSBtYW51YWwgc3luYy4gV29ya2VyIHBvbGxzIHRoZSBTcXVhcmUgUE9TIEFQSSB0byBmZXRjaFxuICAgIC8vICAgbWVudSBpdGVtIHNhbGVzIGRhdGEsIHRoZW4gbWF0Y2hlcyBTcXVhcmUgaXRlbXMgdG8gcmVjaXBlcyBieSBuYW1lIGFuZFxuICAgIC8vICAgdXBkYXRlcyBtZW51IHNlbGxpbmcgcHJpY2VzLlxuICAgIC8vXG4gICAgLy8gU0xBIChSZXF1aXJlbWVudCAxMi4yKTogU3luYyBhdCBsZWFzdCBvbmNlIGV2ZXJ5IDI0IGhvdXJzLlxuICAgIC8vXG4gICAgLy8gRklGTyBlbnN1cmVzIHN5bmNzIGZvciB0aGUgc2FtZSB2ZW51ZSBhcmUgcHJvY2Vzc2VkIHNlcXVlbnRpYWxseS5cbiAgICAvLyBDb250ZW50LWJhc2VkIGRlZHVwbGljYXRpb24gcHJldmVudHMgZHVwbGljYXRlIHN5bmNzIGlmIHRoZSBzY2hlZHVsZXIgYW5kXG4gICAgLy8gbWFudWFsIHRyaWdnZXIgZmlyZSBzaW11bHRhbmVvdXNseS5cblxuICAgIHRoaXMuc3F1YXJlU3luY0RscSA9IG5ldyBzcXMuUXVldWUodGhpcywgJ1NxdWFyZVN5bmNEbHEnLCB7XG4gICAgICBxdWV1ZU5hbWU6IGBmY2Mtc3F1YXJlLXN5bmMtZGxxLSR7ZW52TmFtZX0uZmlmb2AsXG4gICAgICBmaWZvOiB0cnVlLFxuICAgICAgY29udGVudEJhc2VkRGVkdXBsaWNhdGlvbjogdHJ1ZSxcbiAgICAgIHJldGVudGlvblBlcmlvZDogY2RrLkR1cmF0aW9uLmRheXMobWVzc2FnZVJldGVudGlvbkRheXMpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5zcXVhcmVTeW5jUXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdTcXVhcmVTeW5jUXVldWUnLCB7XG4gICAgICBxdWV1ZU5hbWU6IGBmY2Mtc3F1YXJlLXN5bmMtJHtlbnZOYW1lfS5maWZvYCxcbiAgICAgIGZpZm86IHRydWUsXG4gICAgICBjb250ZW50QmFzZWREZWR1cGxpY2F0aW9uOiB0cnVlLFxuICAgICAgcmV0ZW50aW9uUGVyaW9kOiBjZGsuRHVyYXRpb24uZGF5cyhtZXNzYWdlUmV0ZW50aW9uRGF5cyksXG4gICAgICB2aXNpYmlsaXR5VGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTIwKSwgLy8gMiBtaW51dGVzIGZvciBTcXVhcmUgQVBJIHBhZ2luYXRpb24gKyBEQiB1cGRhdGVzXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHtcbiAgICAgICAgcXVldWU6IHRoaXMuc3F1YXJlU3luY0RscSxcbiAgICAgICAgbWF4UmVjZWl2ZUNvdW50LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIENsb3VkV2F0Y2ggQWxhcm1zIG9uIERMUSBEZXB0aFxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vXG4gICAgLy8gRWFjaCBETFEgZ2V0cyBhIENsb3VkV2F0Y2ggYWxhcm0gdGhhdCBmaXJlcyB3aGVuIEFwcHJveGltYXRlTnVtYmVyT2ZNZXNzYWdlc1Zpc2libGUgPiAwLlxuICAgIC8vIFRoaXMgc2lnbmFscyB0aGF0IG1lc3NhZ2VzIGhhdmUgbW92ZWQgdG8gdGhlIERMUSBkdWUgdG8gcmVwZWF0ZWQgcHJvY2Vzc2luZ1xuICAgIC8vIGZhaWx1cmVzLCByZXF1aXJpbmcgaW52ZXN0aWdhdGlvbiBieSB0aGUgb3BlcmF0aW9ucyB0ZWFtLlxuICAgIC8vXG4gICAgLy8gQWxhcm0gdGhyZXNob2xkOiA+IDAgbWVzc2FnZXMgKGFueSBtZXNzYWdlIGluIGEgRExRIGlzIGEgc2lnbmFsIG9mIGZhaWx1cmUpXG4gICAgLy8gRXZhbHVhdGlvbiBwZXJpb2RzOiAxIGRhdGEgcG9pbnQgb3ZlciA1IG1pbnV0ZXMgKENsb3VkV2F0Y2ggZGVmYXVsdCBncmFudWxhcml0eSlcbiAgICAvLyBUcmVhdCBtaXNzaW5nIGRhdGE6IE5PVCBicmVhY2hpbmcgKG1pc3NpbmcgZGF0YSBtZWFucyBubyBtZXNzYWdlcyBpbiBETFEpXG5cbiAgICB0aGlzLmNvc3RQcm9wYWdhdGlvbkRscUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0Nvc3RQcm9wYWdhdGlvbkRscUFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiBgZmNjLWNvc3QtcHJvcGFnYXRpb24tZGxxLWFsYXJtLSR7ZW52TmFtZX1gLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIHdoZW4gY29zdCBwcm9wYWdhdGlvbiBETFEgaGFzIG1lc3NhZ2VzIChwcm9jZXNzaW5nIGZhaWx1cmVzKScsXG4gICAgICBtZXRyaWM6IHRoaXMuY29zdFByb3BhZ2F0aW9uRGxxLm1ldHJpY0FwcHJveGltYXRlTnVtYmVyT2ZNZXNzYWdlc1Zpc2libGUoe1xuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICBzdGF0aXN0aWM6IGNsb3Vkd2F0Y2guU3RhdHMuTUFYSU1VTSxcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAwLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICB9KTtcblxuICAgIHRoaXMub2NyUHJvY2Vzc2luZ0RscUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ09jclByb2Nlc3NpbmdEbHFBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogYGZjYy1vY3ItcHJvY2Vzc2luZy1kbHEtYWxhcm0tJHtlbnZOYW1lfWAsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQWxhcm0gd2hlbiBPQ1IgcHJvY2Vzc2luZyBETFEgaGFzIG1lc3NhZ2VzIChUZXh0cmFjdCBvciBwYXJzaW5nIGZhaWx1cmVzKScsXG4gICAgICBtZXRyaWM6IHRoaXMub2NyUHJvY2Vzc2luZ0RscS5tZXRyaWNBcHByb3hpbWF0ZU51bWJlck9mTWVzc2FnZXNWaXNpYmxlKHtcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgc3RhdGlzdGljOiBjbG91ZHdhdGNoLlN0YXRzLk1BWElNVU0sXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMCxcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgfSk7XG5cbiAgICB0aGlzLmFpSW5zaWdodHNEbHFBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdBaUluc2lnaHRzRGxxQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6IGBmY2MtYWktaW5zaWdodHMtZGxxLWFsYXJtLSR7ZW52TmFtZX1gLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIHdoZW4gQUkgaW5zaWdodHMgRExRIGhhcyBtZXNzYWdlcyAoQmVkcm9jayBvciBhbmFseXNpcyBmYWlsdXJlcyknLFxuICAgICAgbWV0cmljOiB0aGlzLmFpSW5zaWdodHNEbHEubWV0cmljQXBwcm94aW1hdGVOdW1iZXJPZk1lc3NhZ2VzVmlzaWJsZSh7XG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5NQVhJTVVNLFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDAsXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuXG4gICAgdGhpcy5zcXVhcmVTeW5jRGxxQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnU3F1YXJlU3luY0RscUFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiBgZmNjLXNxdWFyZS1zeW5jLWRscS1hbGFybS0ke2Vudk5hbWV9YCxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGFybSB3aGVuIFNxdWFyZSBzeW5jIERMUSBoYXMgbWVzc2FnZXMgKFNxdWFyZSBBUEkgb3IgbWF0Y2hpbmcgZmFpbHVyZXMpJyxcbiAgICAgIG1ldHJpYzogdGhpcy5zcXVhcmVTeW5jRGxxLm1ldHJpY0FwcHJveGltYXRlTnVtYmVyT2ZNZXNzYWdlc1Zpc2libGUoe1xuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICBzdGF0aXN0aWM6IGNsb3Vkd2F0Y2guU3RhdHMuTUFYSU1VTSxcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAwLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBDbG91ZEZvcm1hdGlvbiBPdXRwdXRzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIEV4cG9ydGVkIHNvIGRvd25zdHJlYW0gc3RhY2tzICh3b3JrZXIgc2VydmljZSwgQVBJIHNlcnZpY2UpIGNhbiBpbXBvcnRcbiAgICAvLyBxdWV1ZSBVUkxzIGFuZCBBUk5zIHdpdGhvdXQgaGFyZC1jb2RpbmcuXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ29zdFByb3BhZ2F0aW9uUXVldWVVcmwnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5jb3N0UHJvcGFnYXRpb25RdWV1ZS5xdWV1ZVVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29zdCBwcm9wYWdhdGlvbiBxdWV1ZSBVUkwnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUNvc3RQcm9wYWdhdGlvblF1ZXVlVXJsYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDb3N0UHJvcGFnYXRpb25RdWV1ZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmNvc3RQcm9wYWdhdGlvblF1ZXVlLnF1ZXVlQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdDb3N0IHByb3BhZ2F0aW9uIHF1ZXVlIEFSTicsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tQ29zdFByb3BhZ2F0aW9uUXVldWVBcm5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ09jclByb2Nlc3NpbmdRdWV1ZVVybCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm9jclByb2Nlc3NpbmdRdWV1ZS5xdWV1ZVVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnT0NSIHByb2Nlc3NpbmcgcXVldWUgVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1PY3JQcm9jZXNzaW5nUXVldWVVcmxgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ09jclByb2Nlc3NpbmdRdWV1ZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm9jclByb2Nlc3NpbmdRdWV1ZS5xdWV1ZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnT0NSIHByb2Nlc3NpbmcgcXVldWUgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1PY3JQcm9jZXNzaW5nUXVldWVBcm5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FpSW5zaWdodHNRdWV1ZVVybCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmFpSW5zaWdodHNRdWV1ZS5xdWV1ZVVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQUkgaW5zaWdodHMgcXVldWUgVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1BaUluc2lnaHRzUXVldWVVcmxgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FpSW5zaWdodHNRdWV1ZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmFpSW5zaWdodHNRdWV1ZS5xdWV1ZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQUkgaW5zaWdodHMgcXVldWUgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1BaUluc2lnaHRzUXVldWVBcm5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NxdWFyZVN5bmNRdWV1ZVVybCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnNxdWFyZVN5bmNRdWV1ZS5xdWV1ZVVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3F1YXJlIHN5bmMgcXVldWUgVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1TcXVhcmVTeW5jUXVldWVVcmxgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NxdWFyZVN5bmNRdWV1ZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnNxdWFyZVN5bmNRdWV1ZS5xdWV1ZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3F1YXJlIHN5bmMgcXVldWUgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1TcXVhcmVTeW5jUXVldWVBcm5gLFxuICAgIH0pO1xuXG4gICAgLy8gRExRIG91dHB1dHMgKGZvciBtb25pdG9yaW5nIGFuZCBvcGVyYXRpb25hbCBkYXNoYm9hcmRzKVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nvc3RQcm9wYWdhdGlvbkRscVVybCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmNvc3RQcm9wYWdhdGlvbkRscS5xdWV1ZVVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29zdCBwcm9wYWdhdGlvbiBETFEgVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1Db3N0UHJvcGFnYXRpb25EbHFVcmxgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ09jclByb2Nlc3NpbmdEbHFVcmwnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5vY3JQcm9jZXNzaW5nRGxxLnF1ZXVlVXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdPQ1IgcHJvY2Vzc2luZyBETFEgVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1PY3JQcm9jZXNzaW5nRGxxVXJsYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBaUluc2lnaHRzRGxxVXJsJywge1xuICAgICAgdmFsdWU6IHRoaXMuYWlJbnNpZ2h0c0RscS5xdWV1ZVVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQUkgaW5zaWdodHMgRExRIFVSTCcsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tQWlJbnNpZ2h0c0RscVVybGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU3F1YXJlU3luY0RscVVybCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnNxdWFyZVN5bmNEbHEucXVldWVVcmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NxdWFyZSBzeW5jIERMUSBVUkwnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVNxdWFyZVN5bmNEbHFVcmxgLFxuICAgIH0pO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBBbGFybSBBUk5zIChmb3IgU05TIHRvcGljIHN1YnNjcmlwdGlvbiBpbiBPYnNlcnZhYmlsaXR5U3RhY2spXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ29zdFByb3BhZ2F0aW9uRGxxQWxhcm1Bcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5jb3N0UHJvcGFnYXRpb25EbHFBbGFybS5hbGFybUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29zdCBwcm9wYWdhdGlvbiBETFEgYWxhcm0gQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1Db3N0UHJvcGFnYXRpb25EbHFBbGFybUFybmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT2NyUHJvY2Vzc2luZ0RscUFsYXJtQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMub2NyUHJvY2Vzc2luZ0RscUFsYXJtLmFsYXJtQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdPQ1IgcHJvY2Vzc2luZyBETFEgYWxhcm0gQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1PY3JQcm9jZXNzaW5nRGxxQWxhcm1Bcm5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FpSW5zaWdodHNEbHFBbGFybUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmFpSW5zaWdodHNEbHFBbGFybS5hbGFybUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQUkgaW5zaWdodHMgRExRIGFsYXJtIEFSTicsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tQWlJbnNpZ2h0c0RscUFsYXJtQXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTcXVhcmVTeW5jRGxxQWxhcm1Bcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5zcXVhcmVTeW5jRGxxQWxhcm0uYWxhcm1Bcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ1NxdWFyZSBzeW5jIERMUSBhbGFybSBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVNxdWFyZVN5bmNEbHFBbGFybUFybmAsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==