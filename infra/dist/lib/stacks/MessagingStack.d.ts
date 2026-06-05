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
export declare class MessagingStack extends cdk.Stack {
    /** Cost propagation queue — used when ingredient prices change to trigger recipe recalculation */
    readonly costPropagationQueue: sqs.Queue;
    /** OCR processing queue — used for invoice upload and Textract extraction */
    readonly ocrProcessingQueue: sqs.Queue;
    /** AI insights queue — used for generating profitability and supplier insights */
    readonly aiInsightsQueue: sqs.Queue;
    /** Square sync queue — used for polling and syncing Square POS sales data */
    readonly squareSyncQueue: sqs.Queue;
    /** Dead-letter queue for cost propagation failures */
    readonly costPropagationDlq: sqs.Queue;
    /** Dead-letter queue for OCR processing failures */
    readonly ocrProcessingDlq: sqs.Queue;
    /** Dead-letter queue for AI insights generation failures */
    readonly aiInsightsDlq: sqs.Queue;
    /** Dead-letter queue for Square sync failures */
    readonly squareSyncDlq: sqs.Queue;
    /** CloudWatch alarm for cost propagation DLQ depth */
    readonly costPropagationDlqAlarm: cloudwatch.Alarm;
    /** CloudWatch alarm for OCR processing DLQ depth */
    readonly ocrProcessingDlqAlarm: cloudwatch.Alarm;
    /** CloudWatch alarm for AI insights DLQ depth */
    readonly aiInsightsDlqAlarm: cloudwatch.Alarm;
    /** CloudWatch alarm for Square sync DLQ depth */
    readonly squareSyncDlqAlarm: cloudwatch.Alarm;
    constructor(scope: Construct, id: string, props: MessagingStackProps);
}
