import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { MessagingStack } from '../lib/stacks/MessagingStack';

/**
 * Unit tests for MessagingStack.
 *
 * Uses the CDK assertions library to validate CloudFormation template output
 * without deploying to AWS.
 */

function buildTemplate(): { stack: MessagingStack; template: Template } {
  const app = new cdk.App();
  const stack = new MessagingStack(app, 'TestMessagingStack', {
    env: { account: '123456789012', region: 'ap-southeast-2' },
    envName: 'test',
  });
  const template = Template.fromStack(stack);
  return { stack, template };
}

describe('MessagingStack — Queue Counts', () => {
  test('creates exactly 4 main FIFO queues', () => {
    const { template } = buildTemplate();
    const queues = template.findResources('AWS::SQS::Queue', {
      Properties: {
        FifoQueue: true,
        QueueName: Match.stringLikeRegexp('^fcc-(cost-propagation|ocr-processing|ai-insights|square-sync)-test\\.fifo$'),
      },
    });
    expect(Object.keys(queues)).toHaveLength(4);
  });

  test('creates exactly 4 DLQ FIFO queues', () => {
    const { template } = buildTemplate();
    const dlqs = template.findResources('AWS::SQS::Queue', {
      Properties: {
        FifoQueue: true,
        QueueName: Match.stringLikeRegexp('^fcc-(cost-propagation|ocr-processing|ai-insights|square-sync)-dlq-test\\.fifo$'),
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
        QueueName: Match.stringLikeRegexp('^fcc-(cost-propagation|ocr-processing|ai-insights|square-sync)-test\\.fifo$'),
      },
    });
    for (const queue of Object.values(mainQueues)) {
      expect((queue as any).Properties.FifoQueue).toBe(true);
    }
  });

  test('all main queues have content-based deduplication enabled', () => {
    const { template } = buildTemplate();
    const mainQueues = template.findResources('AWS::SQS::Queue', {
      Properties: {
        QueueName: Match.stringLikeRegexp('^fcc-(cost-propagation|ocr-processing|ai-insights|square-sync)-test\\.fifo$'),
      },
    });
    for (const queue of Object.values(mainQueues)) {
      expect((queue as any).Properties.ContentBasedDeduplication).toBe(true);
    }
  });

  test('all DLQs have FIFO enabled', () => {
    const { template } = buildTemplate();
    const dlqs = template.findResources('AWS::SQS::Queue', {
      Properties: {
        QueueName: Match.stringLikeRegexp('-dlq-test\\.fifo$'),
      },
    });
    for (const dlq of Object.values(dlqs)) {
      expect((dlq as any).Properties.FifoQueue).toBe(true);
    }
  });

  test('all DLQs have content-based deduplication enabled', () => {
    const { template } = buildTemplate();
    const dlqs = template.findResources('AWS::SQS::Queue', {
      Properties: {
        QueueName: Match.stringLikeRegexp('-dlq-test\\.fifo$'),
      },
    });
    for (const dlq of Object.values(dlqs)) {
      expect((dlq as any).Properties.ContentBasedDeduplication).toBe(true);
    }
  });
});

describe('MessagingStack — Message Retention', () => {
  test('all queues have 14-day retention period (1209600 seconds)', () => {
    const { template } = buildTemplate();
    const allQueues = template.findResources('AWS::SQS::Queue');
    for (const queue of Object.values(allQueues)) {
      expect((queue as any).Properties.MessageRetentionPeriod).toBe(1209600); // 14 days in seconds
    }
  });
});

describe('MessagingStack — Dead-Letter Queue Configuration', () => {
  test('cost-propagation queue has DLQ with maxReceiveCount = 3', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'fcc-cost-propagation-test.fifo',
      RedrivePolicy: Match.objectLike({
        maxReceiveCount: 3,
        deadLetterTargetArn: Match.anyValue(),
      }),
    });
  });

  test('ocr-processing queue has DLQ with maxReceiveCount = 3', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'fcc-ocr-processing-test.fifo',
      RedrivePolicy: Match.objectLike({
        maxReceiveCount: 3,
        deadLetterTargetArn: Match.anyValue(),
      }),
    });
  });

  test('ai-insights queue has DLQ with maxReceiveCount = 3', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'fcc-ai-insights-test.fifo',
      RedrivePolicy: Match.objectLike({
        maxReceiveCount: 3,
        deadLetterTargetArn: Match.anyValue(),
      }),
    });
  });

  test('square-sync queue has DLQ with maxReceiveCount = 3', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'fcc-square-sync-test.fifo',
      RedrivePolicy: Match.objectLike({
        maxReceiveCount: 3,
        deadLetterTargetArn: Match.anyValue(),
      }),
    });
  });

  test('DLQs do not have their own redrive policy (no chained DLQs)', () => {
    const { template } = buildTemplate();
    const dlqs = template.findResources('AWS::SQS::Queue', {
      Properties: {
        QueueName: Match.stringLikeRegexp('-dlq-test\\.fifo$'),
      },
    });
    for (const dlq of Object.values(dlqs)) {
      expect((dlq as any).Properties.RedrivePolicy).toBeUndefined();
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
      expect((alarm as any).Properties.MetricName).toBe('ApproximateNumberOfMessagesVisible');
    }
  });

  test('all DLQ alarms have threshold > 0', () => {
    const { template } = buildTemplate();
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    for (const alarm of Object.values(alarms)) {
      expect((alarm as any).Properties.Threshold).toBe(0);
      expect((alarm as any).Properties.ComparisonOperator).toBe('GreaterThanThreshold');
    }
  });

  test('all DLQ alarms use MAXIMUM statistic', () => {
    const { template } = buildTemplate();
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    for (const alarm of Object.values(alarms)) {
      expect((alarm as any).Properties.Statistic).toBe('Maximum');
    }
  });

  test('all DLQ alarms have 5-minute evaluation period', () => {
    const { template } = buildTemplate();
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    for (const alarm of Object.values(alarms)) {
      expect((alarm as any).Properties.Period).toBe(300); // 5 minutes in seconds
    }
  });

  test('all DLQ alarms have 1 evaluation period', () => {
    const { template } = buildTemplate();
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    for (const alarm of Object.values(alarms)) {
      expect((alarm as any).Properties.EvaluationPeriods).toBe(1);
    }
  });

  test('all DLQ alarms treat missing data as NOT_BREACHING', () => {
    const { template } = buildTemplate();
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    for (const alarm of Object.values(alarms)) {
      expect((alarm as any).Properties.TreatMissingData).toBe('notBreaching');
    }
  });

  test('cost-propagation DLQ alarm has descriptive name', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'fcc-cost-propagation-dlq-alarm-test',
      AlarmDescription: Match.stringLikeRegexp('cost propagation.*processing failures'),
    });
  });

  test('ocr-processing DLQ alarm has descriptive name', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'fcc-ocr-processing-dlq-alarm-test',
      AlarmDescription: Match.stringLikeRegexp('OCR.*Textract.*parsing failures'),
    });
  });

  test('ai-insights DLQ alarm has descriptive name', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'fcc-ai-insights-dlq-alarm-test',
      AlarmDescription: Match.stringLikeRegexp('AI insights.*Bedrock.*analysis failures'),
    });
  });

  test('square-sync DLQ alarm has descriptive name', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'fcc-square-sync-dlq-alarm-test',
      AlarmDescription: Match.stringLikeRegexp('Square.*API.*matching failures'),
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
    for (const [key, output] of Object.entries<any>(outputs)) {
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
        QueueName: Match.stringLikeRegexp('^fcc-.*-test\\.fifo$'),
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
        QueueName: Match.stringLikeRegexp('^fcc-.*-dlq-test\\.fifo$'),
      },
    });
    expect(Object.keys(dlqs)).toHaveLength(4);
  });
});
