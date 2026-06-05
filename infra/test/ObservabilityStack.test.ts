import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ObservabilityStack } from '../lib/stacks/ObservabilityStack';

/**
 * Unit tests for ObservabilityStack.
 *
 * Uses the CDK assertions library to validate CloudFormation template output
 * without deploying to AWS.
 */

function buildTemplate(): { stack: ObservabilityStack; template: Template } {
  const app = new cdk.App();
  const stack = new ObservabilityStack(app, 'TestObservabilityStack', {
    env: { account: '123456789012', region: 'ap-southeast-2' },
    envName: 'test',
  });
  const template = Template.fromStack(stack);
  return { stack, template };
}

describe('ObservabilityStack — Log Groups', () => {
  test('creates exactly 2 CloudWatch log groups', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::Logs::LogGroup', 2);
  });

  test('API log group has 30-day retention', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/food-cost-calculator/test/api',
      RetentionInDays: 30,
    });
  });

  test('Workers log group has 30-day retention', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/food-cost-calculator/test/workers',
      RetentionInDays: 30,
    });
  });
});

describe('ObservabilityStack — X-Ray Groups', () => {
  test('creates exactly 2 X-Ray groups', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::XRay::Group', 2);
  });

  test('API X-Ray group filters by service("api")', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::XRay::Group', {
      GroupName: 'food-cost-calculator-api-test',
      FilterExpression: 'service("api")',
    });
  });

  test('Workers X-Ray group filters by service("workers")', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::XRay::Group', {
      GroupName: 'food-cost-calculator-workers-test',
      FilterExpression: 'service("workers")',
    });
  });
});

describe('ObservabilityStack — CloudWatch Alarms', () => {
  test('creates API latency alarm with 2000ms threshold', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'fcc-api-p99-latency-test',
      Threshold: 2000,
      ComparisonOperator: 'GreaterThanThreshold',
    });
  });

  test('creates API error rate alarm with 1% threshold', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'fcc-api-5xx-error-rate-test',
      Threshold: 1,
      ComparisonOperator: 'GreaterThanThreshold',
    });
  });
});

describe('ObservabilityStack — CloudWatch Dashboards', () => {
  test('creates exactly 4 CloudWatch dashboards', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 4);
  });

  test('API dashboard has correct name', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'FoodCostCalculator-API-test',
    });
  });

  test('Workers dashboard has correct name', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'FoodCostCalculator-Workers-test',
    });
  });

  test('Database dashboard has correct name', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'FoodCostCalculator-Database-test',
    });
  });

  test('Cache dashboard has correct name', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'FoodCostCalculator-Cache-test',
    });
  });
});
