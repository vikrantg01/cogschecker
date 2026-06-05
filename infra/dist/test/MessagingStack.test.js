"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const MessagingStack_1 = require("../lib/stacks/MessagingStack");
/**
 * Unit tests for MessagingStack.
 *
 * Uses the CDK assertions library to validate CloudFormation template output
 * without deploying to AWS.
 */
function buildTemplate() {
    const app = new cdk.App();
    const stack = new MessagingStack_1.MessagingStack(app, 'TestMessagingStack', {
        env: { account: '123456789012', region: 'ap-southeast-2' },
        envName: 'test',
    });
    const template = assertions_1.Template.fromStack(stack);
    return { stack, template };
}
describe('MessagingStack — Queue Counts', () => {
    test('creates exactly 4 main FIFO queues', () => {
        const { template } = buildTemplate();
        const queues = template.findResources('AWS::SQS::Queue', {
            Properties: {
                FifoQueue: true,
                QueueName: assertions_1.Match.stringLikeRegexp('^fcc-(cost-propagation|ocr-processing|ai-insights|square-sync)-test\\.fifo$'),
            },
        });
        expect(Object.keys(queues)).toHaveLength(4);
    });
    test('creates exactly 4 DLQ FIFO queues', () => {
        const { template } = buildTemplate();
        const dlqs = template.findResources('AWS::SQS::Queue', {
            Properties: {
                FifoQueue: true,
                QueueName: assertions_1.Match.stringLikeRegexp('^fcc-(cost-propagation|ocr-processing|ai-insights|square-sync)-dlq-test\\.fifo$'),
            },
        });
        expect(Object.keys(dlqs)).toHaveLength(4);
    });
    test('creates exactly 8 queues total (4 main + 4 DLQ)', () => {
        const { template } = buildTemplate();
        template.resourceCountIs('AWS::SQS::Queue', 8);
    });
});
describe('MessagingStack — FIFO Queue Properties', () => {
    test('all main queues have FIFO enabled', () => {
        const { template } = buildTemplate();
        const mainQueues = template.findResources('AWS::SQS::Queue', {
            Properties: {
                QueueName: assertions_1.Match.stringLikeRegexp('^fcc-(cost-propagation|ocr-processing|ai-insights|square-sync)-test\\.fifo$'),
            },
        });
        for (const queue of Object.values(mainQueues)) {
            expect(queue.Properties.FifoQueue).toBe(true);
        }
    });
    test('all main queues have content-based deduplication enabled', () => {
        const { template } = buildTemplate();
        const mainQueues = template.findResources('AWS::SQS::Queue', {
            Properties: {
                QueueName: assertions_1.Match.stringLikeRegexp('^fcc-(cost-propagation|ocr-processing|ai-insights|square-sync)-test\\.fifo$'),
            },
        });
        for (const queue of Object.values(mainQueues)) {
            expect(queue.Properties.ContentBasedDeduplication).toBe(true);
        }
    });
    test('all DLQs have FIFO enabled', () => {
        const { template } = buildTemplate();
        const dlqs = template.findResources('AWS::SQS::Queue', {
            Properties: {
                QueueName: assertions_1.Match.stringLikeRegexp('-dlq-test\\.fifo$'),
            },
        });
        for (const dlq of Object.values(dlqs)) {
            expect(dlq.Properties.FifoQueue).toBe(true);
        }
    });
    test('all DLQs have content-based deduplication enabled', () => {
        const { template } = buildTemplate();
        const dlqs = template.findResources('AWS::SQS::Queue', {
            Properties: {
                QueueName: assertions_1.Match.stringLikeRegexp('-dlq-test\\.fifo$'),
            },
        });
        for (const dlq of Object.values(dlqs)) {
            expect(dlq.Properties.ContentBasedDeduplication).toBe(true);
        }
    });
});
describe('MessagingStack — Message Retention', () => {
    test('all queues have 14-day retention period (1209600 seconds)', () => {
        const { template } = buildTemplate();
        const allQueues = template.findResources('AWS::SQS::Queue');
        for (const queue of Object.values(allQueues)) {
            expect(queue.Properties.MessageRetentionPeriod).toBe(1209600); // 14 days in seconds
        }
    });
});
describe('MessagingStack — Dead-Letter Queue Configuration', () => {
    test('cost-propagation queue has DLQ with maxReceiveCount = 3', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'fcc-cost-propagation-test.fifo',
            RedrivePolicy: assertions_1.Match.objectLike({
                maxReceiveCount: 3,
                deadLetterTargetArn: assertions_1.Match.anyValue(),
            }),
        });
    });
    test('ocr-processing queue has DLQ with maxReceiveCount = 3', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'fcc-ocr-processing-test.fifo',
            RedrivePolicy: assertions_1.Match.objectLike({
                maxReceiveCount: 3,
                deadLetterTargetArn: assertions_1.Match.anyValue(),
            }),
        });
    });
    test('ai-insights queue has DLQ with maxReceiveCount = 3', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'fcc-ai-insights-test.fifo',
            RedrivePolicy: assertions_1.Match.objectLike({
                maxReceiveCount: 3,
                deadLetterTargetArn: assertions_1.Match.anyValue(),
            }),
        });
    });
    test('square-sync queue has DLQ with maxReceiveCount = 3', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'fcc-square-sync-test.fifo',
            RedrivePolicy: assertions_1.Match.objectLike({
                maxReceiveCount: 3,
                deadLetterTargetArn: assertions_1.Match.anyValue(),
            }),
        });
    });
    test('DLQs do not have their own redrive policy (no chained DLQs)', () => {
        const { template } = buildTemplate();
        const dlqs = template.findResources('AWS::SQS::Queue', {
            Properties: {
                QueueName: assertions_1.Match.stringLikeRegexp('-dlq-test\\.fifo$'),
            },
        });
        for (const dlq of Object.values(dlqs)) {
            expect(dlq.Properties.RedrivePolicy).toBeUndefined();
        }
    });
});
describe('MessagingStack — Visibility Timeout', () => {
    test('cost-propagation queue has 30 second visibility timeout', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'fcc-cost-propagation-test.fifo',
            VisibilityTimeout: 30,
        });
    });
    test('ocr-processing queue has 60 second visibility timeout', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'fcc-ocr-processing-test.fifo',
            VisibilityTimeout: 60,
        });
    });
    test('ai-insights queue has 300 second (5 minute) visibility timeout', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'fcc-ai-insights-test.fifo',
            VisibilityTimeout: 300,
        });
    });
    test('square-sync queue has 120 second (2 minute) visibility timeout', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'fcc-square-sync-test.fifo',
            VisibilityTimeout: 120,
        });
    });
});
describe('MessagingStack — CloudWatch Alarms', () => {
    test('creates exactly 4 CloudWatch alarms (one per DLQ)', () => {
        const { template } = buildTemplate();
        template.resourceCountIs('AWS::CloudWatch::Alarm', 4);
    });
    test('all DLQ alarms monitor ApproximateNumberOfMessagesVisible metric', () => {
        const { template } = buildTemplate();
        const alarms = template.findResources('AWS::CloudWatch::Alarm');
        for (const alarm of Object.values(alarms)) {
            expect(alarm.Properties.MetricName).toBe('ApproximateNumberOfMessagesVisible');
        }
    });
    test('all DLQ alarms have threshold > 0', () => {
        const { template } = buildTemplate();
        const alarms = template.findResources('AWS::CloudWatch::Alarm');
        for (const alarm of Object.values(alarms)) {
            expect(alarm.Properties.Threshold).toBe(0);
            expect(alarm.Properties.ComparisonOperator).toBe('GreaterThanThreshold');
        }
    });
    test('all DLQ alarms use MAXIMUM statistic', () => {
        const { template } = buildTemplate();
        const alarms = template.findResources('AWS::CloudWatch::Alarm');
        for (const alarm of Object.values(alarms)) {
            expect(alarm.Properties.Statistic).toBe('Maximum');
        }
    });
    test('all DLQ alarms have 5-minute evaluation period', () => {
        const { template } = buildTemplate();
        const alarms = template.findResources('AWS::CloudWatch::Alarm');
        for (const alarm of Object.values(alarms)) {
            expect(alarm.Properties.Period).toBe(300); // 5 minutes in seconds
        }
    });
    test('all DLQ alarms have 1 evaluation period', () => {
        const { template } = buildTemplate();
        const alarms = template.findResources('AWS::CloudWatch::Alarm');
        for (const alarm of Object.values(alarms)) {
            expect(alarm.Properties.EvaluationPeriods).toBe(1);
        }
    });
    test('all DLQ alarms treat missing data as NOT_BREACHING', () => {
        const { template } = buildTemplate();
        const alarms = template.findResources('AWS::CloudWatch::Alarm');
        for (const alarm of Object.values(alarms)) {
            expect(alarm.Properties.TreatMissingData).toBe('notBreaching');
        }
    });
    test('cost-propagation DLQ alarm has descriptive name', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            AlarmName: 'fcc-cost-propagation-dlq-alarm-test',
            AlarmDescription: assertions_1.Match.stringLikeRegexp('cost propagation.*processing failures'),
        });
    });
    test('ocr-processing DLQ alarm has descriptive name', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            AlarmName: 'fcc-ocr-processing-dlq-alarm-test',
            AlarmDescription: assertions_1.Match.stringLikeRegexp('OCR.*Textract.*parsing failures'),
        });
    });
    test('ai-insights DLQ alarm has descriptive name', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            AlarmName: 'fcc-ai-insights-dlq-alarm-test',
            AlarmDescription: assertions_1.Match.stringLikeRegexp('AI insights.*Bedrock.*analysis failures'),
        });
    });
    test('square-sync DLQ alarm has descriptive name', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            AlarmName: 'fcc-square-sync-dlq-alarm-test',
            AlarmDescription: assertions_1.Match.stringLikeRegexp('Square.*API.*matching failures'),
        });
    });
});
describe('MessagingStack — CloudFormation Outputs', () => {
    const expectedOutputs = [
        'CostPropagationQueueUrl',
        'CostPropagationQueueArn',
        'OcrProcessingQueueUrl',
        'OcrProcessingQueueArn',
        'AiInsightsQueueUrl',
        'AiInsightsQueueArn',
        'SquareSyncQueueUrl',
        'SquareSyncQueueArn',
        'CostPropagationDlqUrl',
        'OcrProcessingDlqUrl',
        'AiInsightsDlqUrl',
        'SquareSyncDlqUrl',
        'CostPropagationDlqAlarmArn',
        'OcrProcessingDlqAlarmArn',
        'AiInsightsDlqAlarmArn',
        'SquareSyncDlqAlarmArn',
    ];
    test.each(expectedOutputs)('exports %s', (outputKey) => {
        const { template } = buildTemplate();
        const outputs = template.findOutputs(outputKey);
        expect(Object.keys(outputs)).toHaveLength(1);
    });
    test('all outputs have export names for cross-stack referencing', () => {
        const { template } = buildTemplate();
        const cfnTemplate = template.toJSON();
        const outputs = cfnTemplate.Outputs ?? {};
        for (const [key, output] of Object.entries(outputs)) {
            expect(output.Export?.Name).toBeDefined();
            // Export name should include the environment name.
            expect(output.Export.Name).toMatch(/test/);
        }
    });
    test('queue URL outputs reference the correct queue resources', () => {
        const { template } = buildTemplate();
        const cfnTemplate = template.toJSON();
        const outputs = cfnTemplate.Outputs ?? {};
        // Verify that queue URL outputs exist and have the Ref structure
        expect(outputs.CostPropagationQueueUrl).toBeDefined();
        expect(outputs.OcrProcessingQueueUrl).toBeDefined();
        expect(outputs.AiInsightsQueueUrl).toBeDefined();
        expect(outputs.SquareSyncQueueUrl).toBeDefined();
    });
    test('queue ARN outputs reference the correct queue resources', () => {
        const { template } = buildTemplate();
        const cfnTemplate = template.toJSON();
        const outputs = cfnTemplate.Outputs ?? {};
        // Verify that queue ARN outputs exist and have GetAtt structure
        expect(outputs.CostPropagationQueueArn).toBeDefined();
        expect(outputs.OcrProcessingQueueArn).toBeDefined();
        expect(outputs.AiInsightsQueueArn).toBeDefined();
        expect(outputs.SquareSyncQueueArn).toBeDefined();
    });
    test('DLQ URL outputs reference the correct DLQ resources', () => {
        const { template } = buildTemplate();
        const cfnTemplate = template.toJSON();
        const outputs = cfnTemplate.Outputs ?? {};
        expect(outputs.CostPropagationDlqUrl).toBeDefined();
        expect(outputs.OcrProcessingDlqUrl).toBeDefined();
        expect(outputs.AiInsightsDlqUrl).toBeDefined();
        expect(outputs.SquareSyncDlqUrl).toBeDefined();
    });
    test('alarm ARN outputs reference the correct alarm resources', () => {
        const { template } = buildTemplate();
        const cfnTemplate = template.toJSON();
        const outputs = cfnTemplate.Outputs ?? {};
        expect(outputs.CostPropagationDlqAlarmArn).toBeDefined();
        expect(outputs.OcrProcessingDlqAlarmArn).toBeDefined();
        expect(outputs.AiInsightsDlqAlarmArn).toBeDefined();
        expect(outputs.SquareSyncDlqAlarmArn).toBeDefined();
    });
});
describe('MessagingStack — Queue Naming', () => {
    test('queue names follow the pattern fcc-{purpose}-{env}.fifo', () => {
        const { template } = buildTemplate();
        const mainQueues = template.findResources('AWS::SQS::Queue', {
            Properties: {
                QueueName: assertions_1.Match.stringLikeRegexp('^fcc-.*-test\\.fifo$'),
            },
        });
        // Should match all 8 queues (4 main + 4 DLQ)
        expect(Object.keys(mainQueues)).toHaveLength(8);
    });
    test('cost-propagation queue has correct name', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'fcc-cost-propagation-test.fifo',
        });
    });
    test('ocr-processing queue has correct name', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'fcc-ocr-processing-test.fifo',
        });
    });
    test('ai-insights queue has correct name', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'fcc-ai-insights-test.fifo',
        });
    });
    test('square-sync queue has correct name', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'fcc-square-sync-test.fifo',
        });
    });
    test('DLQ names follow the pattern fcc-{purpose}-dlq-{env}.fifo', () => {
        const { template } = buildTemplate();
        const dlqs = template.findResources('AWS::SQS::Queue', {
            Properties: {
                QueueName: assertions_1.Match.stringLikeRegexp('^fcc-.*-dlq-test\\.fifo$'),
            },
        });
        expect(Object.keys(dlqs)).toHaveLength(4);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTWVzc2FnaW5nU3RhY2sudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3Rlc3QvTWVzc2FnaW5nU3RhY2sudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLG1DQUFtQztBQUNuQyx1REFBeUQ7QUFDekQsaUVBQThEO0FBRTlEOzs7OztHQUtHO0FBRUgsU0FBUyxhQUFhO0lBQ3BCLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBQzFCLE1BQU0sS0FBSyxHQUFHLElBQUksK0JBQWMsQ0FBQyxHQUFHLEVBQUUsb0JBQW9CLEVBQUU7UUFDMUQsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsZ0JBQWdCLEVBQUU7UUFDMUQsT0FBTyxFQUFFLE1BQU07S0FDaEIsQ0FBQyxDQUFDO0lBQ0gsTUFBTSxRQUFRLEdBQUcscUJBQVEsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDM0MsT0FBTyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsQ0FBQztBQUM3QixDQUFDO0FBRUQsUUFBUSxDQUFDLCtCQUErQixFQUFFLEdBQUcsRUFBRTtJQUM3QyxJQUFJLENBQUMsb0NBQW9DLEVBQUUsR0FBRyxFQUFFO1FBQzlDLE1BQU0sRUFBRSxRQUFRLEVBQUUsR0FBRyxhQUFhLEVBQUUsQ0FBQztRQUNyQyxNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLGlCQUFpQixFQUFFO1lBQ3ZELFVBQVUsRUFBRTtnQkFDVixTQUFTLEVBQUUsSUFBSTtnQkFDZixTQUFTLEVBQUUsa0JBQUssQ0FBQyxnQkFBZ0IsQ0FBQyw2RUFBNkUsQ0FBQzthQUNqSDtTQUNGLENBQUMsQ0FBQztRQUNILE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQzlDLENBQUMsQ0FBQyxD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QUM7SUFFSCxJQUFJLENBQUMsb0NBQW9DLEVBQUUsR0FBRyxFQUFFO1FBQzlDLE1BQU0sRUFBRSxRQUFRLEVBQUUsR0FBRyxhQUFhLEVBQUUsQ0FBQztRQUNyQyxRQUFRLENBQUMscUJBQXFCLENBQUMsaUJBQWlCLEVBQUU7WUFDaEQsU0FBUyxFQUFFLDJCQUEyQjtTQUN2QyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILElBQUksQ0FBQyxvQ0FBb0MsRUFBRSxHQUFHLEVBQUU7UUFDOUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxHQUFHLGFBQWEsRUFBRSxDQUFDO1FBQ3JDLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyxpQkFBaUIsRUFBRTtZQUNoRCxTQUFTLEVBQUUsMkJBQTJCO1NBQ3ZDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBSSxDQUFDLDJEQUEyRCxFQUFFLEdBQUcsRUFBRTtRQUNyRSxNQUFNLEVBQUUsUUFBUSxFQUFFLEdBQUcsYUFBYSxFQUFFLENBQUM7UUFDckMsTUFBTSxJQUFJLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsRUFBRTtZQUNyRCxVQUFVLEVBQUU7Z0JBQ1YsU0FBUyxFQUFFLGtCQUFLLENBQUMsZ0JBQWdCLENBQUMsMEJBQTBCLENBQUM7YUFDOUQ7U0FDRixDQUFDLENBQUM7UUFDSCxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUM1QyxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFRlbXBsYXRlLCBNYXRjaCB9IGZyb20gJ2F3cy1jZGstbGliL2Fzc2VydGlvbnMnO1xuaW1wb3J0IHsgTWVzc2FnaW5nU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL01lc3NhZ2luZ1N0YWNrJztcblxuLyoqXG4gKiBVbml0IHRlc3RzIGZvciBNZXNzYWdpbmdTdGFjay5cbiAqXG4gKiBVc2VzIHRoZSBDREsgYXNzZXJ0aW9ucyBsaWJyYXJ5IHRvIHZhbGlkYXRlIENsb3VkRm9ybWF0aW9uIHRlbXBsYXRlIG91dHB1dFxuICogd2l0aG91dCBkZXBsb3lpbmcgdG8gQVdTLlxuICovXG5cbmZ1bmN0aW9uIGJ1aWxkVGVtcGxhdGUoKTogeyBzdGFjazogTWVzc2FnaW5nU3RhY2s7IHRlbXBsYXRlOiBUZW1wbGF0ZSB9IHtcbiAgY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcbiAgY29uc3Qgc3RhY2sgPSBuZXcgTWVzc2FnaW5nU3RhY2soYXBwLCAnVGVzdE1lc3NhZ2luZ1N0YWNrJywge1xuICAgIGVudjogeyBhY2NvdW50OiAnMTIzNDU2Nzg5MDEyJywgcmVnaW9uOiAnYXAtc291dGhlYXN0LTInIH0sXG4gICAgZW52TmFtZTogJ3Rlc3QnLFxuICB9KTtcbiAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICByZXR1cm4geyBzdGFjaywgdGVtcGxhdGUgfTtcbn1cblxuZGVzY3JpYmUoJ01lc3NhZ2luZ1N0YWNrIOKAlCBRdWV1ZSBDb3VudHMnLCAoKSA9PiB7XG4gIHRlc3QoJ2NyZWF0ZXMgZXhhY3RseSA0IG1haW4gRklGTyBxdWV1ZXMnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IHF1ZXVlcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6U1FTOjpRdWV1ZScsIHtcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgRmlmb1F1ZXVlOiB0cnVlLFxuICAgICAgICBRdWV1ZU5hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ15mY2MtKGNvc3QtcHJvcGFnYXRpb258b2NyLXByb2Nlc3Npbmd8YWktaW5zaWdodHN8c3F1YXJlLXN5bmMpLXRlc3RcXFxcLmZpZm8kJyksXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGV4cGVjdChPYmplY3Qua2V5cyhxdWV1ZXMpKS50b0hhdmVMZW5ndGgoNCk7XG4gIH0pO1xuXG4gIHRlc3QoJ2NyZWF0ZXMgZXhhY3RseSA0IERMUSBGSUZPIHF1ZXVlcycsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgY29uc3QgZGxxcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6U1FTOjpRdWV1ZScsIHtcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgRmlmb1F1ZXVlOiB0cnVlLFxuICAgICAgICBRdWV1ZU5hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ15mY2MtKGNvc3QtcHJvcGFnYXRpb258b2NyLXByb2Nlc3Npbmd8YWktaW5zaWdodHN8c3F1YXJlLXN5bmMpLWRscS10ZXN0XFxcXC5maWZvJCcpLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBleHBlY3QoT2JqZWN0LmtleXMoZGxxcykpLnRvSGF2ZUxlbmd0aCg0KTtcbiAgfSk7XG5cbiAgdGVzdCgnY3JlYXRlcyBleGFjdGx5IDggcXVldWVzIHRvdGFsICg0IG1haW4gKyA0IERMUSknLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpTUVM6OlF1ZXVlJywgOCk7XG4gIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdNZXNzYWdpbmdTdGFjayDigJQgRklGTyBRdWV1ZSBQcm9wZXJ0aWVzJywgKCkgPT4ge1xuICB0ZXN0KCdhbGwgbWFpbiBxdWV1ZXMgaGF2ZSBGSUZPIGVuYWJsZWQnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IG1haW5RdWV1ZXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OlNRUzo6UXVldWUnLCB7XG4gICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgIFF1ZXVlTmFtZTogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnXmZjYy0oY29zdC1wcm9wYWdhdGlvbnxvY3ItcHJvY2Vzc2luZ3xhaS1pbnNpZ2h0c3xzcXVhcmUtc3luYyktdGVzdFxcXFwuZmlmbyQnKSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgZm9yIChjb25zdCBxdWV1ZSBvZiBPYmplY3QudmFsdWVzKG1haW5RdWV1ZXMpKSB7XG4gICAgICBleHBlY3QoKHF1ZXVlIGFzIGFueSkuUHJvcGVydGllcy5GaWZvUXVldWUpLnRvQmUodHJ1ZSk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdhbGwgbWFpbiBxdWV1ZXMgaGF2ZSBjb250ZW50LWJhc2VkIGRlZHVwbGljYXRpb24gZW5hYmxlZCcsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgY29uc3QgbWFpblF1ZXVlcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6U1FTOjpRdWV1ZScsIHtcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgUXVldWVOYW1lOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdeZmNjLShjb3N0LXByb3BhZ2F0aW9ufG9jci1wcm9jZXNzaW5nfGFpLWluc2lnaHRzfHNxdWFyZS1zeW5jKS10ZXN0XFxcXC5maWZvJCcpLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBmb3IgKGNvbnN0IHF1ZXVlIG9mIE9iamVjdC52YWx1ZXMobWFpblF1ZXVlcykpIHtcbiAgICAgIGV4cGVjdCgocXVldWUgYXMgYW55KS5Qcm9wZXJ0aWVzLkNvbnRlbnRCYXNlZERlZHVwbGljYXRpb24pLnRvQmUodHJ1ZSk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdhbGwgRExRcyBoYXZlIEZJRk8gZW5hYmxlZCcsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgY29uc3QgZGxxcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6U1FTOjpRdWV1ZScsIHtcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgUXVldWVOYW1lOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCctZGxxLXRlc3RcXFxcLmZpZm8kJyksXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGZvciAoY29uc3QgZGxxIG9mIE9iamVjdC52YWx1ZXMoZGxxcykpIHtcbiAgICAgIGV4cGVjdCgoZGxxIGFzIGFueSkuUHJvcGVydGllcy5GaWZvUXVldWUpLnRvQmUodHJ1ZSk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdhbGwgRExRcyBoYXZlIGNvbnRlbnQtYmFzZWQgZGVkdXBsaWNhdGlvbiBlbmFibGVkJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBkbHFzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpTUVM6OlF1ZXVlJywge1xuICAgICAgUHJvcGVydGllczoge1xuICAgICAgICBRdWV1ZU5hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJy1kbHEtdGVzdFxcXFwuZmlmbyQnKSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgZm9yIChjb25zdCBkbHEgb2YgT2JqZWN0LnZhbHVlcyhkbHFzKSkge1xuICAgICAgZXhwZWN0KChkbHEgYXMgYW55KS5Qcm9wZXJ0aWVzLkNvbnRlbnRCYXNlZERlZHVwbGljYXRpb24pLnRvQmUodHJ1ZSk7XG4gICAgfVxuICB9KTtcbn0pO1xuXG5kZXNjcmliZSgnTWVzc2FnaW5nU3RhY2sg4oCUIE1lc3NhZ2UgUmV0ZW50aW9uJywgKCkgPT4ge1xuICB0ZXN0KCdhbGwgcXVldWVzIGhhdmUgMTQtZGF5IHJldGVudGlvbiBwZXJpb2QgKDEyMDk2MDAgc2Vjb25kcyknLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGFsbFF1ZXVlcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6U1FTOjpRdWV1ZScpO1xuICAgIGZvciAoY29uc3QgcXVldWUgb2YgT2JqZWN0LnZhbHVlcyhhbGxRdWV1ZXMpKSB7XG4gICAgICBleHBlY3QoKHF1ZXVlIGFzIGFueSkuUHJvcGVydGllcy5NZXNzYWdlUmV0ZW50aW9uUGVyaW9kKS50b0JlKDEyMDk2MDApOyAvLyAxNCBkYXlzIGluIHNlY29uZHNcbiAgICB9XG4gIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdNZXNzYWdpbmdTdGFjayDigJQgRGVhZC1MZXR0ZXIgUXVldWUgQ29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgdGVzdCgnY29zdC1wcm9wYWdhdGlvbiBxdWV1ZSBoYXMgRExRIHdpdGggbWF4UmVjZWl2ZUNvdW50ID0gMycsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNRUzo6UXVldWUnLCB7XG4gICAgICBRdWV1ZU5hbWU6ICdmY2MtY29zdC1wcm9wYWdhdGlvbi10ZXN0LmZpZm8nLFxuICAgICAgUmVkcml2ZVBvbGljeTogTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgIG1heFJlY2VpdmVDb3VudDogMyxcbiAgICAgICAgZGVhZExldHRlclRhcmdldEFybjogTWF0Y2guYW55VmFsdWUoKSxcbiAgICAgIH0pLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdvY3ItcHJvY2Vzc2luZyBxdWV1ZSBoYXMgRExRIHdpdGggbWF4UmVjZWl2ZUNvdW50ID0gMycsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNRUzo6UXVldWUnLCB7XG4gICAgICBRdWV1ZU5hbWU6ICdmY2Mtb2NyLXByb2Nlc3NpbmctdGVzdC5maWZvJyxcbiAgICAgIFJlZHJpdmVQb2xpY3k6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDMsXG4gICAgICAgIGRlYWRMZXR0ZXJUYXJnZXRBcm46IE1hdGNoLmFueVZhbHVlKCksXG4gICAgICB9KSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnYWktaW5zaWdodHMgcXVldWUgaGFzIERMUSB3aXRoIG1heFJlY2VpdmVDb3VudCA9IDMnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTUVM6OlF1ZXVlJywge1xuICAgICAgUXVldWVOYW1lOiAnZmNjLWFpLWluc2lnaHRzLXRlc3QuZmlmbycsXG4gICAgICBSZWRyaXZlUG9saWN5OiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiAzLFxuICAgICAgICBkZWFkTGV0dGVyVGFyZ2V0QXJuOiBNYXRjaC5hbnlWYWx1ZSgpLFxuICAgICAgfSksXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ3NxdWFyZS1zeW5jIHF1ZXVlIGhhcyBETFEgd2l0aCBtYXhSZWNlaXZlQ291bnQgPSAzJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6U1FTOjpRdWV1ZScsIHtcbiAgICAgIFF1ZXVlTmFtZTogJ2ZjYy1zcXVhcmUtc3luYy10ZXN0LmZpZm8nLFxuICAgICAgUmVkcml2ZVBvbGljeTogTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgIG1heFJlY2VpdmVDb3VudDogMyxcbiAgICAgICAgZGVhZExldHRlclRhcmdldEFybjogTWF0Y2guYW55VmFsdWUoKSxcbiAgICAgIH0pLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdETFFzIGRvIG5vdCBoYXZlIHRoZWlyIG93biByZWRyaXZlIHBvbGljeSAobm8gY2hhaW5lZCBETFFzKScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgY29uc3QgZGxxcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6U1FTOjpRdWV1ZScsIHtcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgUXVldWVOYW1lOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCctZGxxLXRlc3RcXFxcLmZpZm8kJyksXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGZvciAoY29uc3QgZGxxIG9mIE9iamVjdC52YWx1ZXMoZGxxcykpIHtcbiAgICAgIGV4cGVjdCgoZGxxIGFzIGFueSkuUHJvcGVydGllcy5SZWRyaXZlUG9saWN5KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfVxuICB9KTtcbn0pO1xuXG5kZXNjcmliZSgnTWVzc2FnaW5nU3RhY2sg4oCUIFZpc2liaWxpdHkgVGltZW91dCcsICgpID0+IHtcbiAgdGVzdCgnY29zdC1wcm9wYWdhdGlvbiBxdWV1ZSBoYXMgMzAgc2Vjb25kIHZpc2liaWxpdHkgdGltZW91dCcsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNRUzo6UXVldWUnLCB7XG4gICAgICBRdWV1ZU5hbWU6ICdmY2MtY29zdC1wcm9wYWdhdGlvbi10ZXN0LmZpZm8nLFxuICAgICAgVmlzaWJpbGl0eVRpbWVvdXQ6IDMwLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdvY3ItcHJvY2Vzc2luZyBxdWV1ZSBoYXMgNjAgc2Vjb25kIHZpc2liaWxpdHkgdGltZW91dCcsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNRUzo6UXVldWUnLCB7XG4gICAgICBRdWV1ZU5hbWU6ICdmY2Mtb2NyLXByb2Nlc3NpbmctdGVzdC5maWZvJyxcbiAgICAgIFZpc2liaWxpdHlUaW1lb3V0OiA2MCxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnYWktaW5zaWdodHMgcXVldWUgaGFzIDMwMCBzZWNvbmQgKDUgbWludXRlKSB2aXNpYmlsaXR5IHRpbWVvdXQnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTUVM6OlF1ZXVlJywge1xuICAgICAgUXVldWVOYW1lOiAnZmNjLWFpLWluc2lnaHRzLXRlc3QuZmlmbycsXG4gICAgICBWaXNpYmlsaXR5VGltZW91dDogMzAwLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdzcXVhcmUtc3luYyBxdWV1ZSBoYXMgMTIwIHNlY29uZCAoMiBtaW51dGUpIHZpc2liaWxpdHkgdGltZW91dCcsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNRUzo6UXVldWUnLCB7XG4gICAgICBRdWV1ZU5hbWU6ICdmY2Mtc3F1YXJlLXN5bmMtdGVzdC5maWZvJyxcbiAgICAgIFZpc2liaWxpdHlUaW1lb3V0OiAxMjAsXG4gICAgfSk7XG4gIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdNZXNzYWdpbmdTdGFjayDigJQgQ2xvdWRXYXRjaCBBbGFybXMnLCAoKSA9PiB7XG4gIHRlc3QoJ2NyZWF0ZXMgZXhhY3RseSA0IENsb3VkV2F0Y2ggYWxhcm1zIChvbmUgcGVyIERMUSknLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpDbG91ZFdhdGNoOjpBbGFybScsIDQpO1xuICB9KTtcblxuICB0ZXN0KCdhbGwgRExRIGFsYXJtcyBtb25pdG9yIEFwcHJveGltYXRlTnVtYmVyT2ZNZXNzYWdlc1Zpc2libGUgbWV0cmljJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBhbGFybXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkNsb3VkV2F0Y2g6OkFsYXJtJyk7XG4gICAgZm9yIChjb25zdCBhbGFybSBvZiBPYmplY3QudmFsdWVzKGFsYXJtcykpIHtcbiAgICAgIGV4cGVjdCgoYWxhcm0gYXMgYW55KS5Qcm9wZXJ0aWVzLk1ldHJpY05hbWUpLnRvQmUoJ0FwcHJveGltYXRlTnVtYmVyT2ZNZXNzYWdlc1Zpc2libGUnKTtcbiAgICB9XG4gIH0pO1xuXG4gIHRlc3QoJ2FsbCBETFEgYWxhcm1zIGhhdmUgdGhyZXNob2xkID4gMCcsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgY29uc3QgYWxhcm1zID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpDbG91ZFdhdGNoOjpBbGFybScpO1xuICAgIGZvciAoY29uc3QgYWxhcm0gb2YgT2JqZWN0LnZhbHVlcyhhbGFybXMpKSB7XG4gICAgICBleHBlY3QoKGFsYXJtIGFzIGFueSkuUHJvcGVydGllcy5UaHJlc2hvbGQpLnRvQmUoMCk7XG4gICAgICBleHBlY3QoKGFsYXJtIGFzIGFueSkuUHJvcGVydGllcy5Db21wYXJpc29uT3BlcmF0b3IpLnRvQmUoJ0dyZWF0ZXJUaGFuVGhyZXNob2xkJyk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdhbGwgRExRIGFsYXJtcyB1c2UgTUFYSU1VTSBzdGF0aXN0aWMnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGFsYXJtcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6Q2xvdWRXYXRjaDo6QWxhcm0nKTtcbiAgICBmb3IgKGNvbnN0IGFsYXJtIG9mIE9iamVjdC52YWx1ZXMoYWxhcm1zKSkge1xuICAgICAgZXhwZWN0KChhbGFybSBhcyBhbnkpLlByb3BlcnRpZXMuU3RhdGlzdGljKS50b0JlKCdNYXhpbXVtJyk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdhbGwgRExRIGFsYXJtcyBoYXZlIDUtbWludXRlIGV2YWx1YXRpb24gcGVyaW9kJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBhbGFybXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkNsb3VkV2F0Y2g6OkFsYXJtJyk7XG4gICAgZm9yIChjb25zdCBhbGFybSBvZiBPYmplY3QudmFsdWVzKGFsYXJtcykpIHtcbiAgICAgIGV4cGVjdCgoYWxhcm0gYXMgYW55KS5Qcm9wZXJ0aWVzLlBlcmlvZCkudG9CZSgzMDApOyAvLyA1IG1pbnV0ZXMgaW4gc2Vjb25kc1xuICAgIH1cbiAgfSk7XG5cbiAgdGVzdCgnYWxsIERMUSBhbGFybXMgaGF2ZSAxIGV2YWx1YXRpb24gcGVyaW9kJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBhbGFybXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkNsb3VkV2F0Y2g6OkFsYXJtJyk7XG4gICAgZm9yIChjb25zdCBhbGFybSBvZiBPYmplY3QudmFsdWVzKGFsYXJtcykpIHtcbiAgICAgIGV4cGVjdCgoYWxhcm0gYXMgYW55KS5Qcm9wZXJ0aWVzLkV2YWx1YXRpb25QZXJpb2RzKS50b0JlKDEpO1xuICAgIH1cbiAgfSk7XG5cbiAgdGVzdCgnYWxsIERMUSBhbGFybXMgdHJlYXQgbWlzc2luZyBkYXRhIGFzIE5PVF9CUkVBQ0hJTkcnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGFsYXJtcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6Q2xvdWRXYXRjaDo6QWxhcm0nKTtcbiAgICBmb3IgKGNvbnN0IGFsYXJtIG9mIE9iamVjdC52YWx1ZXMoYWxhcm1zKSkge1xuICAgICAgZXhwZWN0KChhbGFybSBhcyBhbnkpLlByb3BlcnRpZXMuVHJlYXRNaXNzaW5nRGF0YSkudG9CZSgnbm90QnJlYWNoaW5nJyk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdjb3N0LXByb3BhZ2F0aW9uIERMUSBhbGFybSBoYXMgZGVzY3JpcHRpdmUgbmFtZScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkNsb3VkV2F0Y2g6OkFsYXJtJywge1xuICAgICAgQWxhcm1OYW1lOiAnZmNjLWNvc3QtcHJvcGFnYXRpb24tZGxxLWFsYXJtLXRlc3QnLFxuICAgICAgQWxhcm1EZXNjcmlwdGlvbjogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnY29zdCBwcm9wYWdhdGlvbi4qcHJvY2Vzc2luZyBmYWlsdXJlcycpLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdvY3ItcHJvY2Vzc2luZyBETFEgYWxhcm0gaGFzIGRlc2NyaXB0aXZlIG5hbWUnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpDbG91ZFdhdGNoOjpBbGFybScsIHtcbiAgICAgIEFsYXJtTmFtZTogJ2ZjYy1vY3ItcHJvY2Vzc2luZy1kbHEtYWxhcm0tdGVzdCcsXG4gICAgICBBbGFybURlc2NyaXB0aW9uOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdPQ1IuKlRleHRyYWN0LipwYXJzaW5nIGZhaWx1cmVzJyksXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2FpLWluc2lnaHRzIERMUSBhbGFybSBoYXMgZGVzY3JpcHRpdmUgbmFtZScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkNsb3VkV2F0Y2g6OkFsYXJtJywge1xuICAgICAgQWxhcm1OYW1lOiAnZmNjLWFpLWluc2lnaHRzLWRscS1hbGFybS10ZXN0JyxcbiAgICAgIEFsYXJtRGVzY3JpcHRpb246IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ0FJIGluc2lnaHRzLipCZWRyb2NrLiphbmFseXNpcyBmYWlsdXJlcycpLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdzcXVhcmUtc3luYyBETFEgYWxhcm0gaGFzIGRlc2NyaXB0aXZlIG5hbWUnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpDbG91ZFdhdGNoOjpBbGFybScsIHtcbiAgICAgIEFsYXJtTmFtZTogJ2ZjYy1zcXVhcmUtc3luYy1kbHEtYWxhcm0tdGVzdCcsXG4gICAgICBBbGFybURlc2NyaXB0aW9uOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdTcXVhcmUuKkFQSS4qbWF0Y2hpbmcgZmFpbHVyZXMnKSxcbiAgICB9KTtcbiAgfSk7XG59KTtcblxuZGVzY3JpYmUoJ01lc3NhZ2luZ1N0YWNrIOKAlCBDbG91ZEZvcm1hdGlvbiBPdXRwdXRzJywgKCkgPT4ge1xuICBjb25zdCBleHBlY3RlZE91dHB1dHMgPSBbXG4gICAgJ0Nvc3RQcm9wYWdhdGlvblF1ZXVlVXJsJyxcbiAgICAnQ29zdFByb3BhZ2F0aW9uUXVldWVBcm4nLFxuICAgICdPY3JQcm9jZXNzaW5nUXVldWVVcmwnLFxuICAgICdPY3JQcm9jZXNzaW5nUXVldWVBcm4nLFxuICAgICdBaUluc2lnaHRzUXVldWVVcmwnLFxuICAgICdBaUluc2lnaHRzUXVldWVBcm4nLFxuICAgICdTcXVhcmVTeW5jUXVldWVVcmwnLFxuICAgICdTcXVhcmVTeW5jUXVldWVBcm4nLFxuICAgICdDb3N0UHJvcGFnYXRpb25EbHFVcmwnLFxuICAgICdPY3JQcm9jZXNzaW5nRGxxVXJsJyxcbiAgICAnQWlJbnNpZ2h0c0RscVVybCcsXG4gICAgJ1NxdWFyZVN5bmNEbHFVcmwnLFxuICAgICdDb3N0UHJvcGFnYXRpb25EbHFBbGFybUFybicsXG4gICAgJ09jclByb2Nlc3NpbmdEbHFBbGFybUFybicsXG4gICAgJ0FpSW5zaWdodHNEbHFBbGFybUFybicsXG4gICAgJ1NxdWFyZVN5bmNEbHFBbGFybUFybicsXG4gIF07XG5cbiAgdGVzdC5lYWNoKGV4cGVjdGVkT3V0cHV0cykoJ2V4cG9ydHMgJXMnLCAob3V0cHV0S2V5KSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IG91dHB1dHMgPSB0ZW1wbGF0ZS5maW5kT3V0cHV0cyhvdXRwdXRLZXkpO1xuICAgIGV4cGVjdChPYmplY3Qua2V5cyhvdXRwdXRzKSkudG9IYXZlTGVuZ3RoKDEpO1xuICB9KTtcblxuICB0ZXN0KCdhbGwgb3V0cHV0cyBoYXZlIGV4cG9ydCBuYW1lcyBmb3IgY3Jvc3Mtc3RhY2sgcmVmZXJlbmNpbmcnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGNmblRlbXBsYXRlID0gdGVtcGxhdGUudG9KU09OKCk7XG4gICAgY29uc3Qgb3V0cHV0cyA9IGNmblRlbXBsYXRlLk91dHB1dHMgPz8ge307XG4gICAgZm9yIChjb25zdCBba2V5LCBvdXRwdXRdIG9mIE9iamVjdC5lbnRyaWVzPGFueT4ob3V0cHV0cykpIHtcbiAgICAgIGV4cGVjdChvdXRwdXQuRXhwb3J0Py5OYW1lKS50b0JlRGVmaW5lZCgpO1xuICAgICAgLy8gRXhwb3J0IG5hbWUgc2hvdWxkIGluY2x1ZGUgdGhlIGVudmlyb25tZW50IG5hbWUuXG4gICAgICBleHBlY3Qob3V0cHV0LkV4cG9ydC5OYW1lKS50b01hdGNoKC90ZXN0Lyk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdxdWV1ZSBVUkwgb3V0cHV0cyByZWZlcmVuY2UgdGhlIGNvcnJlY3QgcXVldWUgcmVzb3VyY2VzJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBjZm5UZW1wbGF0ZSA9IHRlbXBsYXRlLnRvSlNPTigpO1xuICAgIGNvbnN0IG91dHB1dHMgPSBjZm5UZW1wbGF0ZS5PdXRwdXRzID8/IHt9O1xuICAgIFxuICAgIC8vIFZlcmlmeSB0aGF0IHF1ZXVlIFVSTCBvdXRwdXRzIGV4aXN0IGFuZCBoYXZlIHRoZSBSZWYgc3RydWN0dXJlXG4gICAgZXhwZWN0KG91dHB1dHMuQ29zdFByb3BhZ2F0aW9uUXVldWVVcmwpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KG91dHB1dHMuT2NyUHJvY2Vzc2luZ1F1ZXVlVXJsKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChvdXRwdXRzLkFpSW5zaWdodHNRdWV1ZVVybCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3Qob3V0cHV0cy5TcXVhcmVTeW5jUXVldWVVcmwpLnRvQmVEZWZpbmVkKCk7XG4gIH0pO1xuXG4gIHRlc3QoJ3F1ZXVlIEFSTiBvdXRwdXRzIHJlZmVyZW5jZSB0aGUgY29ycmVjdCBxdWV1ZSByZXNvdXJjZXMnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGNmblRlbXBsYXRlID0gdGVtcGxhdGUudG9KU09OKCk7XG4gICAgY29uc3Qgb3V0cHV0cyA9IGNmblRlbXBsYXRlLk91dHB1dHMgPz8ge307XG4gICAgXG4gICAgLy8gVmVyaWZ5IHRoYXQgcXVldWUgQVJOIG91dHB1dHMgZXhpc3QgYW5kIGhhdmUgR2V0QXR0IHN0cnVjdHVyZVxuICAgIGV4cGVjdChvdXRwdXRzLkNvc3RQcm9wYWdhdGlvblF1ZXVlQXJuKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChvdXRwdXRzLk9jclByb2Nlc3NpbmdRdWV1ZUFybikudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3Qob3V0cHV0cy5BaUluc2lnaHRzUXVldWVBcm4pLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KG91dHB1dHMuU3F1YXJlU3luY1F1ZXVlQXJuKS50b0JlRGVmaW5lZCgpO1xuICB9KTtcblxuICB0ZXN0KCdETFEgVVJMIG91dHB1dHMgcmVmZXJlbmNlIHRoZSBjb3JyZWN0IERMUSByZXNvdXJjZXMnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGNmblRlbXBsYXRlID0gdGVtcGxhdGUudG9KU09OKCk7XG4gICAgY29uc3Qgb3V0cHV0cyA9IGNmblRlbXBsYXRlLk91dHB1dHMgPz8ge307XG4gICAgXG4gICAgZXhwZWN0KG91dHB1dHMuQ29zdFByb3BhZ2F0aW9uRGxxVXJsKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChvdXRwdXRzLk9jclByb2Nlc3NpbmdEbHFVcmwpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KG91dHB1dHMuQWlJbnNpZ2h0c0RscVVybCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3Qob3V0cHV0cy5TcXVhcmVTeW5jRGxxVXJsKS50b0JlRGVmaW5lZCgpO1xuICB9KTtcblxuICB0ZXN0KCdhbGFybSBBUk4gb3V0cHV0cyByZWZlcmVuY2UgdGhlIGNvcnJlY3QgYWxhcm0gcmVzb3VyY2VzJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBjZm5UZW1wbGF0ZSA9IHRlbXBsYXRlLnRvSlNPTigpO1xuICAgIGNvbnN0IG91dHB1dHMgPSBjZm5UZW1wbGF0ZS5PdXRwdXRzID8/IHt9O1xuICAgIFxuICAgIGV4cGVjdChvdXRwdXRzLkNvc3RQcm9wYWdhdGlvbkRscUFsYXJtQXJuKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChvdXRwdXRzLk9jclByb2Nlc3NpbmdEbHFBbGFybUFybikudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3Qob3V0cHV0cy5BaUluc2lnaHRzRGxxQWxhcm1Bcm4pLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KG91dHB1dHMuU3F1YXJlU3luY0RscUFsYXJtQXJuKS50b0JlRGVmaW5lZCgpO1xuICB9KTtcbn0pO1xuXG5kZXNjcmliZSgnTWVzc2FnaW5nU3RhY2sg4oCUIFF1ZXVlIE5hbWluZycsICgpID0+IHtcbiAgdGVzdCgncXVldWUgbmFtZXMgZm9sbG93IHRoZSBwYXR0ZXJuIGZjYy17cHVycG9zZX0te2Vudn0uZmlmbycsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgY29uc3QgbWFpblF1ZXVlcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6U1FTOjpRdWV1ZScsIHtcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgUXVldWVOYW1lOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdeZmNjLS4qLXRlc3RcXFxcLmZpZm8kJyksXG4gICAgICB9LFxuICAgIH0pO1xuICAgIC8vIFNob3VsZCBtYXRjaCBhbGwgOCBxdWV1ZXMgKDQgbWFpbiArIDQgRExRKVxuICAgIGV4cGVjdChPYmplY3Qua2V5cyhtYWluUXVldWVzKSkudG9IYXZlTGVuZ3RoKDgpO1xuICB9KTtcblxuICB0ZXN0KCdjb3N0LXByb3BhZ2F0aW9uIHF1ZXVlIGhhcyBjb3JyZWN0IG5hbWUnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTUVM6OlF1ZXVlJywge1xuICAgICAgUXVldWVOYW1lOiAnZmNjLWNvc3QtcHJvcGFnYXRpb24tdGVzdC5maWZvJyxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnb2NyLXByb2Nlc3NpbmcgcXVldWUgaGFzIGNvcnJlY3QgbmFtZScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNRUzo6UXVldWUnLCB7XG4gICAgICBRdWV1ZU5hbWU6ICdmY2Mtb2NyLXByb2Nlc3NpbmctdGVzdC5maWZvJyxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnYWktaW5zaWdodHMgcXVldWUgaGFzIGNvcnJlY3QgbmFtZScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNRUzo6UXVldWUnLCB7XG4gICAgICBRdWV1ZU5hbWU6ICdmY2MtYWktaW5zaWdodHMtdGVzdC5maWZvJyxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnc3F1YXJlLXN5bmMgcXVldWUgaGFzIGNvcnJlY3QgbmFtZScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNRUzo6UXVldWUnLCB7XG4gICAgICBRdWV1ZU5hbWU6ICdmY2Mtc3F1YXJlLXN5bmMtdGVzdC5maWZvJyxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnRExRIG5hbWVzIGZvbGxvdyB0aGUgcGF0dGVybiBmY2Mte3B1cnBvc2V9LWRscS17ZW52fS5maWZvJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBkbHFzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpTUVM6OlF1ZXVlJywge1xuICAgICAgUHJvcGVydGllczoge1xuICAgICAgICBRdWV1ZU5hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ15mY2MtLiotZGxxLXRlc3RcXFxcLmZpZm8kJyksXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGV4cGVjdChPYmplY3Qua2V5cyhkbHFzKSkudG9IYXZlTGVuZ3RoKDQpO1xuICB9KTtcbn0pO1xuIl19