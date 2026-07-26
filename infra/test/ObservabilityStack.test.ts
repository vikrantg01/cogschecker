import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ObservabilityStack } from '../lib/stacks/ObservabilityStack';

function buildTemplate(): { stack: ObservabilityStack; template: Template } {
  const app = new cdk.App();
  const stack = new ObservabilityStack(app, 'TestObservabilityStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    envName: 'prod',
    alarmEmail: 'test@example.com',
  });
  const template = Template.fromStack(stack);
  return { stack, template };
}

describe('ObservabilityStack — Log Groups', () => {
  test('creates exactly 1 CloudWatch log group', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::Logs::LogGroup', 1);
  });

  test('API log group has correct name and 7-day retention', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/ecs/foodcost-api-prod',
      RetentionInDays: 7,
    });
  });
});

describe('ObservabilityStack — SNS Topic', () => {
  test('creates exactly 1 SNS topic', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::SNS::Topic', 1);
  });

  test('SNS topic has correct name and display name', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'foodcost-alarms-prod',
      DisplayName: 'Food Cost Calculator Alarms',
    });
  });

  test('SNS topic has email subscription when alarmEmail is provided', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::SNS::Subscription', 1);
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'test@example.com',
    });
  });
});

describe('ObservabilityStack — CloudFormation Exports', () => {
  test('exports log group name', () => {
    const { template } = buildTemplate();
    template.hasOutput('LogGroupName', {
      Export: {
        Name: 'FoodCostCalculator-prod-LogGroupName',
      },
    });
  });

  test('exports SNS topic ARN', () => {
    const { template } = buildTemplate();
    template.hasOutput('AlarmTopicArn', {
      Export: {
        Name: 'FoodCostCalculator-prod-AlarmTopicArn',
      },
    });
  });
});

describe('ObservabilityStack — Resource Tags', () => {
  test('all resources have Component tag', () => {
    const { stack } = buildTemplate();
    const tags = cdk.Tags.of(stack);
    expect(tags).toBeDefined();
  });
});

describe('ObservabilityStack — Optional Email Subscription', () => {
  test('SNS topic created without email subscription when alarmEmail is omitted', () => {
    const app = new cdk.App();
    const stack = new ObservabilityStack(app, 'TestObservabilityStackNoEmail', {
      env: { account: '123456789012', region: 'us-east-1' },
      envName: 'prod',
    });
    const template = Template.fromStack(stack);
    
    template.resourceCountIs('AWS::SNS::Topic', 1);
    template.resourceCountIs('AWS::SNS::Subscription', 0);
  });
});

describe('ObservabilityStack — ALB CloudWatch Alarms', () => {
  test('creates ALB unhealthy host alarm when ALB is provided', () => {
    const app = new cdk.App();
    
    // Create a mock ALB
    const mockAlb = {
      loadBalancerArn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/test-alb/1234567890123456',
      loadBalancerFullName: 'app/test-alb/1234567890123456',
    } as any;

    const stack = new ObservabilityStack(app, 'TestObservabilityStackWithALB', {
      env: { account: '123456789012', region: 'us-east-1' },
      envName: 'prod',
      alb: mockAlb,
    });
    const template = Template.fromStack(stack);
    
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'fcc-alb-unhealthy-hosts-prod',
      AlarmDescription: 'ALB unhealthy target count exceeds 0 for 2 consecutive 1-minute periods',
      MetricName: 'UnHealthyHostCount',
      Namespace: 'AWS/ApplicationELB',
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 2,
      Period: 60,
      Statistic: 'Maximum',
      TreatMissingData: 'notBreaching',
    });
  });

  test('creates ALB 5xx error rate alarm when ALB is provided', () => {
    const app = new cdk.App();
    
    // Create a mock ALB
    const mockAlb = {
      loadBalancerArn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/test-alb/1234567890123456',
      loadBalancerFullName: 'app/test-alb/1234567890123456',
    } as any;

    const stack = new ObservabilityStack(app, 'TestObservabilityStackWithALB2', {
      env: { account: '123456789012', region: 'us-east-1' },
      envName: 'prod',
      alb: mockAlb,
    });
    const template = Template.fromStack(stack);
    
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'fcc-alb-5xx-errors-prod',
      AlarmDescription: 'ALB HTTP 5xx error rate exceeds 5% over 5-minute period',
      Threshold: 5,
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 1,
      TreatMissingData: 'notBreaching',
    });
  });

  test('ALB 5xx error rate alarm uses math expression for percentage calculation', () => {
    const app = new cdk.App();
    
    // Create a mock ALB
    const mockAlb = {
      loadBalancerArn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/test-alb/1234567890123456',
      loadBalancerFullName: 'app/test-alb/1234567890123456',
    } as any;

    const stack = new ObservabilityStack(app, 'TestObservabilityStackWithALB3', {
      env: { account: '123456789012', region: 'us-east-1' },
      envName: 'prod',
      alb: mockAlb,
    });
    const template = Template.fromStack(stack);
    
    // Check that the alarm uses Metrics array with math expression
    const alarmResources = template.findResources('AWS::CloudWatch::Alarm', {
      Properties: {
        AlarmName: 'fcc-alb-5xx-errors-prod',
      },
    });
    
    const alarmKey = Object.keys(alarmResources)[0];
    const alarmProps = alarmResources[alarmKey].Properties;
    
    // Verify it has Metrics property (not MetricName)
    expect(alarmProps.Metrics).toBeDefined();
    expect(alarmProps.Metrics.length).toBe(3); // expression + 2 metrics
    
    // Verify the expression
    const expression = alarmProps.Metrics.find((m: any) => m.Expression);
    expect(expression.Expression).toBe('(m1 / m2) * 100');
    
    // Verify the metrics
    const m1 = alarmProps.Metrics.find((m: any) => m.Id === 'm1');
    expect(m1.MetricStat.Metric.MetricName).toBe('HTTPCode_Target_5XX_Count');
    
    const m2 = alarmProps.Metrics.find((m: any) => m.Id === 'm2');
    expect(m2.MetricStat.Metric.MetricName).toBe('RequestCount');
  });

  test('does not create ALB alarms when ALB is not provided', () => {
    const app = new cdk.App();
    const stack = new ObservabilityStack(app, 'TestObservabilityStackNoALB', {
      env: { account: '123456789012', region: 'us-east-1' },
      envName: 'prod',
    });
    const template = Template.fromStack(stack);
    
    // Should not have any alarms with ALB-specific names
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const albAlarms = Object.values(alarms).filter((alarm: any) => 
      alarm.Properties.AlarmName?.includes('alb')
    );
    
    expect(albAlarms.length).toBe(0);
  });
});
