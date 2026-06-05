import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface MessagingStackProps extends cdk.StackProps {
  /** Logical environment name, e.g. "staging" or "prod". Used for naming. */
  readonly envName: string;
}

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
export class MessagingStack extends cdk.Stack {
  /** Cost propagation queue — used when ingredient prices change to trigger recipe recalculation */
  public readonly costPropagationQueue: sqs.Queue;

  /** OCR processing queue — used for invoice upload and Textract extraction */
  public readonly ocrProcessingQueue: sqs.Queue;

  /** AI insights queue — used for generating profitability and supplier insights */
  public readonly aiInsightsQueue: sqs.Queue;

  /** Square sync queue — used for polling and syncing Square POS sales data */
  public readonly squareSyncQueue: sqs.Queue;

  /** Dead-letter queue for cost propagation failures */
  public readonly costPropagationDlq: sqs.Queue;

  /** Dead-letter queue for OCR processing failures */
  public readonly ocrProcessingDlq: sqs.Queue;

  /** Dead-letter queue for AI insights generation failures */
  public readonly aiInsightsDlq: sqs.Queue;

  /** Dead-letter queue for Square sync failures */
  public readonly squareSyncDlq: sqs.Queue;

  /** CloudWatch alarm for cost propagation DLQ depth */
  public readonly costPropagationDlqAlarm: cloudwatch.Alarm;

  /** CloudWatch alarm for OCR processing DLQ depth */
  public readonly ocrProcessingDlqAlarm: cloudwatch.Alarm;

  /** CloudWatch alarm for AI insights DLQ depth */
  public readonly aiInsightsDlqAlarm: cloudwatch.Alarm;

  /** CloudWatch alarm for Square sync DLQ depth */
  public readonly squareSyncDlqAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
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
