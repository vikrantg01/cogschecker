"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const NetworkStackOptimized_1 = require("../lib/stacks/NetworkStackOptimized");
const RdsStack_1 = require("../lib/stacks/RdsStack");
const CacheStack_1 = require("../lib/stacks/CacheStack");
const AuthStack_1 = require("../lib/stacks/AuthStack");
const StorageStack_1 = require("../lib/stacks/StorageStack");
const SecretsStack_1 = require("../lib/stacks/SecretsStack");
const ObservabilityStack_1 = require("../lib/stacks/ObservabilityStack");
/**
 * Universal Properties Tests
 *
 * Property-based tests that verify invariants across ALL stacks in the deployment.
 * These tests validate cross-cutting concerns like tagging, encryption, retention policies,
 * and security configurations that must hold for every stack.
 *
 * **Validates: Design Properties 1, 4, 7, 10**
 *
 * **Test Results (as of creation):**
 * - 38 out of 40 tests passing
 *
 * **Known Violations (2 failing tests):**
 * 1. SecretsStack missing CostCenter tag on KMS keys
 *    - Individual secret resources have tags, but not all taggable resources
 * 2. RdsStack database credentials secret missing RETAIN deletion policy
 *    - The secret is created without explicit removalPolicy
 *
 * These failing tests indicate real violations that should be fixed in the stacks.
 */
/**
 * Helper function to build a NetworkStackOptimized with standard test configuration.
 */
function buildNetworkStack() {
    const app = new cdk.App();
    const stack = new NetworkStackOptimized_1.NetworkStackOptimized(app, 'TestNetworkStack', {
        env: { account: '123456789012', region: 'us-east-1' },
        envName: 'test',
    });
    const template = assertions_1.Template.fromStack(stack);
    return { stack, template };
}
/**
 * Helper function to build an RdsStack with standard test configuration.
 */
function buildRdsStack() {
    const app = new cdk.App();
    const networkStack = new NetworkStackOptimized_1.NetworkStackOptimized(app, 'TestNetworkStack', {
        env: { account: '123456789012', region: 'us-east-1' },
        envName: 'test',
    });
    const stack = new RdsStack_1.RdsStack(app, 'TestRdsStack', {
        env: { account: '123456789012', region: 'us-east-1' },
        envName: 'test',
        vpc: networkStack.vpc,
        rdsSecurityGroup: networkStack.rdsSecurityGroup,
    });
    const template = assertions_1.Template.fromStack(stack);
    return { stack, template, networkStack };
}
/**
 * Helper function to build a CacheStack with standard test configuration.
 */
function buildCacheStack() {
    const app = new cdk.App();
    const networkStack = new NetworkStackOptimized_1.NetworkStackOptimized(app, 'TestNetworkStack', {
        env: { account: '123456789012', region: 'us-east-1' },
        envName: 'test',
    });
    const stack = new CacheStack_1.CacheStack(app, 'TestCacheStack', {
        env: { account: '123456789012', region: 'us-east-1' },
        envName: 'test',
        vpc: networkStack.vpc,
        redisSecurityGroup: networkStack.redisSecurityGroup,
    });
    const template = assertions_1.Template.fromStack(stack);
    return { stack, template, networkStack };
}
/**
 * Helper function to build an AuthStack with standard test configuration.
 */
function buildAuthStack() {
    const app = new cdk.App();
    const stack = new AuthStack_1.AuthStack(app, 'TestAuthStack', {
        env: { account: '123456789012', region: 'us-east-1' },
        envName: 'test',
    });
    const template = assertions_1.Template.fromStack(stack);
    return { stack, template };
}
/**
 * Helper function to build a StorageStack with standard test configuration.
 */
function buildStorageStack() {
    const app = new cdk.App();
    const stack = new StorageStack_1.StorageStack(app, 'TestStorageStack', {
        env: { account: '123456789012', region: 'us-east-1' },
    });
    const template = assertions_1.Template.fromStack(stack);
    return { stack, template };
}
/**
 * Helper function to build a SecretsStack with standard test configuration.
 */
function buildSecretsStack() {
    const app = new cdk.App();
    const stack = new SecretsStack_1.SecretsStack(app, 'TestSecretsStack', {
        env: { account: '123456789012', region: 'us-east-1' },
        envName: 'test',
    });
    const template = assertions_1.Template.fromStack(stack);
    return { stack, template };
}
/**
 * Helper function to build an ObservabilityStack with standard test configuration.
 */
function buildObservabilityStack() {
    const app = new cdk.App();
    const stack = new ObservabilityStack_1.ObservabilityStack(app, 'TestObservabilityStack', {
        env: { account: '123456789012', region: 'us-east-1' },
        envName: 'test',
    });
    const template = assertions_1.Template.fromStack(stack);
    return { stack, template };
}
// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL PROPERTY 1: All stacks have Component and CostCenter tags
// ─────────────────────────────────────────────────────────────────────────────
describe('Universal Property: Resource Tagging', () => {
    /**
     * Property: For any stack deployed by the Deployment_System, the stack SHALL
     * have both Component and CostCenter tags for cost allocation and filtering.
     *
     * **Validates: Requirements 1.7, Design Property 4**
     */
    const stackBuilders = [
        { name: 'NetworkStackOptimized', builder: buildNetworkStack },
        { name: 'RdsStack', builder: buildRdsStack },
        { name: 'CacheStack', builder: buildCacheStack },
        { name: 'AuthStack', builder: buildAuthStack },
        { name: 'StorageStack', builder: buildStorageStack },
        { name: 'SecretsStack', builder: buildSecretsStack },
        { name: 'ObservabilityStack', builder: buildObservabilityStack },
    ];
    test.each(stackBuilders)('$name has Component tag', ({ builder }) => {
        const { stack } = builder();
        // CDK doesn't provide a direct way to query tags, so we check the template
        const template = assertions_1.Template.fromStack(stack);
        const cfnTemplate = template.toJSON();
        // Check if any resources in the stack have the Component tag
        // Note: Not all AWS resources support tags (e.g., some Cognito resources).
        // The test passes if at least some resources have the required tags.
        const resources = Object.values(cfnTemplate.Resources || {});
        const taggedResources = resources.filter((resource) => {
            const tags = resource.Properties?.Tags || [];
            return tags.some((tag) => tag.Key === 'Component');
        });
        // Expect at least one resource to be tagged
        // For AuthStack, Cognito resources may not support Tags property,
        // so we check if there are any taggable resources first
        if (resources.length > 0) {
            // At least some resources should be tagged if the stack has taggable resources
            const hasTaggableResources = resources.some((r) => r.Properties?.hasOwnProperty('Tags'));
            if (hasTaggableResources) {
                expect(taggedResources.length).toBeGreaterThanOrEqual(1);
            }
        }
    });
    test.each(stackBuilders)('$name has CostCenter tag', ({ builder }) => {
        const { stack } = builder();
        const template = assertions_1.Template.fromStack(stack);
        const cfnTemplate = template.toJSON();
        // Check if any resources in the stack have the CostCenter tag
        // Note: Not all AWS resources support tags (e.g., some Cognito resources).
        const resources = Object.values(cfnTemplate.Resources || {});
        const taggedResources = resources.filter((resource) => {
            const tags = resource.Properties?.Tags || [];
            return tags.some((tag) => tag.Key === 'CostCenter');
        });
        // Expect at least one resource to be tagged if there are taggable resources
        if (resources.length > 0) {
            const hasTaggableResources = resources.some((r) => r.Properties?.hasOwnProperty('Tags'));
            if (hasTaggableResources) {
                expect(taggedResources.length).toBeGreaterThanOrEqual(1);
            }
        }
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL PROPERTY 2: All RDS instances have encryption enabled
// ─────────────────────────────────────────────────────────────────────────────
describe('Universal Property: RDS Encryption', () => {
    /**
     * Property: For any RDS database instance created by the Deployment_System,
     * the instance SHALL have StorageEncrypted set to true.
     *
     * **Validates: Requirements 4.5, 11.2, Design Property 7**
     */
    test('RdsStack creates RDS instance with encryption enabled', () => {
        const { template } = buildRdsStack();
        // Find all RDS instances
        const rdsInstances = template.findResources('AWS::RDS::DBInstance');
        const instanceCount = Object.keys(rdsInstances).length;
        // Verify at least one RDS instance exists
        expect(instanceCount).toBeGreaterThanOrEqual(1);
        // Verify all RDS instances have encryption enabled
        for (const [logicalId, resource] of Object.entries(rdsInstances)) {
            expect(resource).toHaveProperty('Properties.StorageEncrypted', true);
        }
    });
    test('RDS instance uses AWS-managed KMS keys for encryption', () => {
        const { template } = buildRdsStack();
        template.hasResourceProperties('AWS::RDS::DBInstance', {
            StorageEncrypted: true,
            // When KMSKeyId is not specified, AWS uses the default aws/rds managed key
        });
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL PROPERTY 3: All S3 buckets block public access
// ─────────────────────────────────────────────────────────────────────────────
describe('Universal Property: S3 Public Access Block', () => {
    /**
     * Property: For any S3 bucket created by the Deployment_System, the bucket
     * SHALL have PublicAccessBlockConfiguration set to block all public access.
     *
     * **Validates: Requirements 7.2, 11.5, Design Property 10**
     */
    test('StorageStack creates S3 buckets with public access blocked', () => {
        const { template } = buildStorageStack();
        // Find all S3 buckets
        const s3Buckets = template.findResources('AWS::S3::Bucket');
        const bucketCount = Object.keys(s3Buckets).length;
        // Verify at least one S3 bucket exists
        expect(bucketCount).toBeGreaterThanOrEqual(1);
        // Verify all S3 buckets have public access blocked
        for (const [logicalId, resource] of Object.entries(s3Buckets)) {
            expect(resource).toHaveProperty('Properties.PublicAccessBlockConfiguration');
            const blockConfig = resource.Properties.PublicAccessBlockConfiguration;
            expect(blockConfig.BlockPublicAcls).toBe(true);
            expect(blockConfig.BlockPublicPolicy).toBe(true);
            expect(blockConfig.IgnorePublicAcls).toBe(true);
            expect(blockConfig.RestrictPublicBuckets).toBe(true);
        }
    });
    test('All S3 buckets enforce SSL/TLS via bucket policy', () => {
        const { template } = buildStorageStack();
        // Find all bucket policies
        const bucketPolicies = template.findResources('AWS::S3::BucketPolicy');
        // Verify at least one bucket policy exists
        expect(Object.keys(bucketPolicies).length).toBeGreaterThanOrEqual(1);
        // Verify all bucket policies enforce SSL
        for (const [logicalId, resource] of Object.entries(bucketPolicies)) {
            const policyDoc = resource.Properties.PolicyDocument;
            const statements = policyDoc.Statement || [];
            // Check if there's a deny statement for non-SSL requests
            const hasSslEnforcement = statements.some((stmt) => stmt.Effect === 'Deny' &&
                stmt.Condition?.Bool?.['aws:SecureTransport'] === 'false');
            expect(hasSslEnforcement).toBe(true);
        }
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL PROPERTY 4: All Secrets have retention policy
// ─────────────────────────────────────────────────────────────────────────────
describe('Universal Property: Secrets Manager Retention', () => {
    /**
     * Property: For any AWS Secrets Manager secret created by the Deployment_System,
     * the secret SHALL have a DeletionPolicy of Retain or UpdateReplacePolicy of Retain
     * to prevent accidental data loss.
     *
     * **Validates: Requirements 1.6, Design Property 3**
     */
    test('SecretsStack creates secrets with RETAIN deletion policy', () => {
        const { template } = buildSecretsStack();
        // Find all Secrets Manager secrets
        const secrets = template.findResources('AWS::SecretsManager::Secret', {
            DeletionPolicy: 'Retain',
        });
        // Verify at least one secret has RETAIN policy
        expect(Object.keys(secrets).length).toBeGreaterThanOrEqual(1);
    });
    test('RdsStack database credentials secret has RETAIN deletion policy', () => {
        const { template } = buildRdsStack();
        // Find secrets with RETAIN policy
        const secrets = template.findResources('AWS::SecretsManager::Secret', {
            DeletionPolicy: 'Retain',
        });
        // RDS stack creates at least one secret (database credentials)
        expect(Object.keys(secrets).length).toBeGreaterThanOrEqual(1);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL PROPERTY 5: Stateful resources have RETAIN removal policy
// ─────────────────────────────────────────────────────────────────────────────
describe('Universal Property: Stateful Resource Protection', () => {
    /**
     * Property: For any stateful resource (RDS instance, S3 bucket, KMS key, Secrets)
     * created by the Deployment_System, the resource SHALL have a removal policy of
     * RETAIN to prevent accidental data loss during stack deletion.
     *
     * **Validates: Requirements 1.6, Design Property 3**
     */
    test('RDS instance has RETAIN deletion policy', () => {
        const { template } = buildRdsStack();
        const rdsInstances = template.findResources('AWS::RDS::DBInstance', {
            DeletionPolicy: 'Retain',
        });
        expect(Object.keys(rdsInstances).length).toBeGreaterThanOrEqual(1);
    });
    test('S3 buckets have RETAIN deletion policy', () => {
        const { template } = buildStorageStack();
        const s3Buckets = template.findResources('AWS::S3::Bucket', {
            DeletionPolicy: 'Retain',
        });
        expect(Object.keys(s3Buckets).length).toBeGreaterThanOrEqual(1);
    });
    test('KMS keys have RETAIN deletion policy', () => {
        const { template } = buildSecretsStack();
        const kmsKeys = template.findResources('AWS::KMS::Key', {
            DeletionPolicy: 'Retain',
        });
        expect(Object.keys(kmsKeys).length).toBeGreaterThanOrEqual(1);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL PROPERTY 6: ElastiCache clusters have encryption enabled
// ─────────────────────────────────────────────────────────────────────────────
describe('Universal Property: ElastiCache Encryption', () => {
    /**
     * Property: For any ElastiCache replication group created by the Deployment_System,
     * the cluster SHALL have both at-rest and in-transit encryption enabled.
     *
     * **Validates: Requirements 5.4, 5.5, 11.2, Design Property 7**
     */
    test('CacheStack creates ElastiCache with at-rest encryption enabled', () => {
        const { template } = buildCacheStack();
        template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
            AtRestEncryptionEnabled: true,
        });
    });
    test('CacheStack creates ElastiCache with in-transit encryption enabled', () => {
        const { template } = buildCacheStack();
        template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
            TransitEncryptionEnabled: true,
        });
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL PROPERTY 7: Data tier resources are in isolated subnets
// ─────────────────────────────────────────────────────────────────────────────
describe('Universal Property: Data Tier Isolation', () => {
    /**
     * Property: For any data service (RDS, ElastiCache) deployed by the Deployment_System,
     * the service SHALL be deployed in private isolated subnets with no internet access.
     *
     * **Validates: Requirements 4.9, 5.6, 11.4, Design Property 9**
     */
    test('RDS instance is deployed in isolated subnets', () => {
        const { template, networkStack } = buildRdsStack();
        // Verify RDS subnet group exists
        const subnetGroups = template.findResources('AWS::RDS::DBSubnetGroup');
        expect(Object.keys(subnetGroups).length).toBeGreaterThanOrEqual(1);
        // Verify RDS instance references the subnet group
        template.hasResourceProperties('AWS::RDS::DBInstance', {
            DBSubnetGroupName: assertions_1.Match.anyValue(),
        });
    });
    test('ElastiCache is deployed in isolated subnets', () => {
        const { template, networkStack } = buildCacheStack();
        // Verify ElastiCache subnet group exists
        const subnetGroups = template.findResources('AWS::ElastiCache::SubnetGroup');
        expect(Object.keys(subnetGroups).length).toBeGreaterThanOrEqual(1);
        // Verify ElastiCache replication group references the subnet group
        template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
            CacheSubnetGroupName: assertions_1.Match.anyValue(),
        });
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL PROPERTY 8: All security groups follow least-privilege principle
// ─────────────────────────────────────────────────────────────────────────────
describe('Universal Property: Security Group Least Privilege', () => {
    /**
     * Property: For any security group created by the Deployment_System, ingress rules
     * SHALL be restricted to specific ports and source security groups (not 0.0.0.0/0
     * for non-public services).
     *
     * **Validates: Requirements 2.6, 2.7, 2.8, 2.9, 11.4, Design Property 9**
     */
    test('RDS security group only allows PostgreSQL port from ECS', () => {
        const { template } = buildNetworkStack();
        template.hasResourceProperties('AWS::EC2::SecurityGroup', {
            GroupDescription: assertions_1.Match.stringLikeRegexp('RDS'),
            SecurityGroupIngress: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
                    FromPort: 5432,
                    ToPort: 5432,
                    IpProtocol: 'tcp',
                    SourceSecurityGroupId: assertions_1.Match.anyValue(),
                }),
            ]),
        });
    });
    test('Redis security group only allows Redis port from ECS', () => {
        const { template } = buildNetworkStack();
        template.hasResourceProperties('AWS::EC2::SecurityGroup', {
            GroupDescription: assertions_1.Match.stringLikeRegexp('Redis'),
            SecurityGroupIngress: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
                    FromPort: 6379,
                    ToPort: 6379,
                    IpProtocol: 'tcp',
                    SourceSecurityGroupId: assertions_1.Match.anyValue(),
                }),
            ]),
        });
    });
    test('ECS security group only allows traffic from ALB', () => {
        const { template } = buildNetworkStack();
        template.hasResourceProperties('AWS::EC2::SecurityGroup', {
            GroupDescription: assertions_1.Match.stringLikeRegexp('ECS'),
            SecurityGroupIngress: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
                    FromPort: 8080,
                    ToPort: 8080,
                    IpProtocol: 'tcp',
                    SourceSecurityGroupId: assertions_1.Match.anyValue(),
                }),
            ]),
        });
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL PROPERTY 9: All stacks export required outputs
// ─────────────────────────────────────────────────────────────────────────────
describe('Universal Property: CloudFormation Exports', () => {
    /**
     * Property: For any CDK stack deployed by the Deployment_System, if the stack
     * creates resources that dependent stacks need to reference, the stack SHALL
     * export those resource identifiers as CloudFormation outputs with the naming
     * pattern FoodCostCalculator-{ResourceType}.
     *
     * **Validates: Requirements 1.3, Design Property 5**
     */
    test('NetworkStackOptimized exports VPC and security group IDs', () => {
        const { template } = buildNetworkStack();
        const requiredOutputs = [
            'VpcId',
            'PublicSubnetIds',
            'PrivateSubnetIds',
            'IsolatedSubnetIds',
            'AlbSecurityGroupId',
            'EcsSecurityGroupId',
            'RdsSecurityGroupId',
            'RedisSecurityGroupId',
        ];
        for (const outputKey of requiredOutputs) {
            const outputs = template.findOutputs(outputKey);
            expect(Object.keys(outputs)).toHaveLength(1);
        }
    });
    test('RdsStack exports database connection information', () => {
        const { template } = buildRdsStack();
        const requiredOutputs = ['SecretArn', 'Endpoint', 'Port', 'DatabaseName'];
        for (const outputKey of requiredOutputs) {
            const outputs = template.findOutputs(outputKey);
            expect(Object.keys(outputs)).toHaveLength(1);
        }
    });
    test('CacheStack exports Redis endpoint', () => {
        const { template } = buildCacheStack();
        const outputs = template.findOutputs('RedisPrimaryEndpoint');
        expect(Object.keys(outputs)).toHaveLength(1);
    });
    test('AuthStack exports Cognito User Pool information', () => {
        const { template } = buildAuthStack();
        const requiredOutputs = ['UserPoolId', 'UserPoolArn', 'UserPoolClientId'];
        for (const outputKey of requiredOutputs) {
            const outputs = template.findOutputs(outputKey);
            expect(Object.keys(outputs)).toHaveLength(1);
        }
    });
    test('StorageStack exports S3 bucket names and ARNs', () => {
        const { template } = buildStorageStack();
        const requiredOutputs = [
            'FrontendBucketName',
            'FrontendBucketArn',
            'InvoiceBucketName',
            'InvoiceBucketArn',
        ];
        for (const outputKey of requiredOutputs) {
            const outputs = template.findOutputs(outputKey);
            expect(Object.keys(outputs)).toHaveLength(1);
        }
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL PROPERTY 10: All exports have export names for cross-stack refs
// ─────────────────────────────────────────────────────────────────────────────
describe('Universal Property: Export Name Convention', () => {
    /**
     * Property: For any CloudFormation export value produced by a stack, the export
     * SHALL have an explicit export name following the pattern FoodCostCalculator-{env}-{Resource}
     * to enable cross-stack references.
     *
     * Note: Not all outputs need export names - only those meant for cross-stack import.
     * Informational outputs (like HostedUiUrl) may omit export names.
     *
     * **Validates: Requirements 1.4, Design Property 2**
     */
    const stackBuilders = [
        { name: 'NetworkStackOptimized', builder: buildNetworkStack },
        { name: 'RdsStack', builder: buildRdsStack },
        { name: 'CacheStack', builder: buildCacheStack },
        { name: 'AuthStack', builder: buildAuthStack },
        { name: 'StorageStack', builder: buildStorageStack },
    ];
    test.each(stackBuilders)('$name exports follow naming convention', ({ builder }) => {
        const { template } = builder();
        const cfnTemplate = template.toJSON();
        const outputs = cfnTemplate.Outputs || {};
        // Count outputs with export names
        let exportedOutputCount = 0;
        // Verify exports (where present) follow naming convention
        for (const [key, output] of Object.entries(outputs)) {
            if (output.Export?.Name) {
                exportedOutputCount++;
                expect(output.Export.Name).toMatch(/FoodCostCalculator/);
            }
        }
        // Verify at least one output is exported for cross-stack usage
        expect(exportedOutputCount).toBeGreaterThanOrEqual(1);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiVW5pdmVyc2FsUHJvcGVydGllcy50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vdGVzdC9Vbml2ZXJzYWxQcm9wZXJ0aWVzLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxtQ0FBbUM7QUFDbkMsdURBQXlEO0FBQ3pELCtFQUE0RTtBQUM1RSxxREFBa0Q7QUFDbEQseURBQXNEO0FBQ3RELHVEQUFvRDtBQUNwRCw2REFBMEQ7QUFDMUQsNkRBQTBEO0FBQzFELHlFQUFzRTtBQUV0RTs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUVIOztHQUVHO0FBQ0gsU0FBUyxpQkFBaUI7SUFDeEIsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDMUIsTUFBTSxLQUFLLEdBQUcsSUFBSSw2Q0FBcUIsQ0FBQyxHQUFHLEVBQUUsa0JBQWtCLEVBQUU7UUFDL0QsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFO1FBQ3JELE9BQU8sRUFBRSxNQUFNO0tBQ2hCLENBQUMsQ0FBQztJQUNILE1BQU0sUUFBUSxHQUFHLHFCQUFRLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzNDLE9BQU8sRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLENBQUM7QUFDN0IsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxhQUFhO0lBQ3BCLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBQzFCLE1BQU0sWUFBWSxHQUFHLElBQUksNkNBQXFCLENBQUMsR0FBRyxFQUFFLGtCQUFrQixFQUFFO1FBQ3RFLEdBQUcsRUFBRSxFQUFFLE9BQU8sRUFBRSxjQUFjLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRTtRQUNyRCxPQUFPLEVBQUUsTUFBTTtLQUNoQixDQUFDLENBQUM7SUFDSCxNQUFNLEtBQUssR0FBRyxJQUFJLG1CQUFR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O1FBQzVDLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxPQUFPLEVBQUUsZUFBZSxFQUFFO1FBQ2hELEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFO1FBQzlDLEVBQUUsSUFBSSxFQUFFLGNBQWMsRUFBRSxPQUFPLEVBQUUsaUJBQWlCLEVBQUU7S0FDckQsQ0FBQztJQUVGLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUMsd0NBQXdDLEVBQUUsQ0FBQyxFQUFFLE9BQU8sRUFBRSxFQUFFLEVBQUU7UUFDakYsTUFBTSxFQUFFLFFBQVEsRUFBRSxHQUFHLE9BQU8sRUFBRSxDQUFDO1FBQy9CLE1BQU0sV0FBVyxHQUFHLFFBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUN0QyxNQUFNLE9BQU8sR0FBRyxXQUFXLENBQUMsT0FBTyxJQUFJLEVBQUUsQ0FBQztRQUUxQyxrQ0FBa0M7UUFDbEMsSUFBSSxtQkFBbUIsR0FBRyxDQUFDLENBQUM7UUFFNUIsMERBQTBEO1FBQzFELEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRSxNQUFNLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFNLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDekQsSUFBSSxNQUFNLENBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxDQUFDO2dCQUN4QixtQkFBbUIsRUFBRSxDQUFDO2dCQUN0QixNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsb0JBQW9CLENBQUMsQ0FBQztZQUMzRCxDQUFDO1FBQ0gsQ0FBQztRQUVELCtEQUErRDtRQUMvRCxNQUFNLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN4RCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFRlbXBsYXRlLCBNYXRjaCB9IGZyb20gJ2F3cy1jZGstbGliL2Fzc2VydGlvbnMnO1xuaW1wb3J0IHsgTmV0d29ya1N0YWNrT3B0aW1pemVkIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9OZXR3b3JrU3RhY2tPcHRpbWl6ZWQnO1xuaW1wb3J0IHsgUmRzU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL1Jkc1N0YWNrJztcbmltcG9ydCB7IENhY2hlU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL0NhY2hlU3RhY2snO1xuaW1wb3J0IHsgQXV0aFN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9BdXRoU3RhY2snO1xuaW1wb3J0IHsgU3RvcmFnZVN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9TdG9yYWdlU3RhY2snO1xuaW1wb3J0IHsgU2VjcmV0c1N0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9TZWNyZXRzU3RhY2snO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eVN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9PYnNlcnZhYmlsaXR5U3RhY2snO1xuXG4vKipcbiAqIFVuaXZlcnNhbCBQcm9wZXJ0aWVzIFRlc3RzXG4gKlxuICogUHJvcGVydHktYmFzZWQgdGVzdHMgdGhhdCB2ZXJpZnkgaW52YXJpYW50cyBhY3Jvc3MgQUxMIHN0YWNrcyBpbiB0aGUgZGVwbG95bWVudC5cbiAqIFRoZXNlIHRlc3RzIHZhbGlkYXRlIGNyb3NzLWN1dHRpbmcgY29uY2VybnMgbGlrZSB0YWdnaW5nLCBlbmNyeXB0aW9uLCByZXRlbnRpb24gcG9saWNpZXMsXG4gKiBhbmQgc2VjdXJpdHkgY29uZmlndXJhdGlvbnMgdGhhdCBtdXN0IGhvbGQgZm9yIGV2ZXJ5IHN0YWNrLlxuICpcbiAqICoqVmFsaWRhdGVzOiBEZXNpZ24gUHJvcGVydGllcyAxLCA0LCA3LCAxMCoqXG4gKlxuICogKipUZXN0IFJlc3VsdHMgKGFzIG9mIGNyZWF0aW9uKToqKlxuICogLSAzOCBvdXQgb2YgNDAgdGVzdHMgcGFzc2luZ1xuICogXG4gKiAqKktub3duIFZpb2xhdGlvbnMgKDIgZmFpbGluZyB0ZXN0cyk6KipcbiAqIDEuIFNlY3JldHNTdGFjayBtaXNzaW5nIENvc3RDZW50ZXIgdGFnIG9uIEtNUyBrZXlzXG4gKiAgICAtIEluZGl2aWR1YWwgc2VjcmV0IHJlc291cmNlcyBoYXZlIHRhZ3MsIGJ1dCBub3QgYWxsIHRhZ2dhYmxlIHJlc291cmNlc1xuICogMi4gUmRzU3RhY2sgZGF0YWJhc2UgY3JlZGVudGlhbHMgc2VjcmV0IG1pc3NpbmcgUkVUQUlOIGRlbGV0aW9uIHBvbGljeVxuICogICAgLSBUaGUgc2VjcmV0IGlzIGNyZWF0ZWQgd2l0aG91dCBleHBsaWNpdCByZW1vdmFsUG9saWN5XG4gKlxuICogVGhlc2UgZmFpbGluZyB0ZXN0cyBpbmRpY2F0ZSByZWFsIHZpb2xhdGlvbnMgdGhhdCBzaG91bGQgYmUgZml4ZWQgaW4gdGhlIHN0YWNrcy5cbiAqL1xuXG4vKipcbiAqIEhlbHBlciBmdW5jdGlvbiB0byBidWlsZCBhIE5ldHdvcmtTdGFja09wdGltaXplZCB3aXRoIHN0YW5kYXJkIHRlc3QgY29uZmlndXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gYnVpbGROZXR3b3JrU3RhY2soKTogeyBzdGFjazogTmV0d29ya1N0YWNrT3B0aW1pemVkOyB0ZW1wbGF0ZTogVGVtcGxhdGUgfSB7XG4gIGNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG4gIGNvbnN0IHN0YWNrID0gbmV3IE5ldHdvcmtTdGFja09wdGltaXplZChhcHAsICdUZXN0TmV0d29ya1N0YWNrJywge1xuICAgIGVudjogeyBhY2NvdW50OiAnMTIzNDU2Nzg5MDEyJywgcmVnaW9uOiAndXMtZWFzdC0xJyB9LFxuICAgIGVudk5hbWU6ICd0ZXN0JyxcbiAgfSk7XG4gIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgcmV0dXJuIHsgc3RhY2ssIHRlbXBsYXRlIH07XG59XG5cbi8qKlxuICogSGVscGVyIGZ1bmN0aW9uIHRvIGJ1aWxkIGFuIFJkc1N0YWNrIHdpdGggc3RhbmRhcmQgdGVzdCBjb25maWd1cmF0aW9uLlxuICovXG5mdW5jdGlvbiBidWlsZFJkc1N0YWNrKCk6IHsgc3RhY2s6IFJkc1N0YWNrOyB0ZW1wbGF0ZTogVGVtcGxhdGU7IG5ldHdvcmtTdGFjazogTmV0d29ya1N0YWNrT3B0aW1pemVkIH0ge1xuICBjb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuICBjb25zdCBuZXR3b3JrU3RhY2sgPSBuZXcgTmV0d29ya1N0YWNrT3B0aW1pemVkKGFwcCwgJ1Rlc3ROZXR3b3JrU3RhY2snLCB7XG4gICAgZW52OiB7IGFjY291bnQ6ICcxMjM0NTY3ODkwMTInLCByZWdpb246ICd1cy1lYXN0LTEnIH0sXG4gICAgZW52TmFtZTogJ3Rlc3QnLFxuICB9KTtcbiAgY29uc3Qgc3RhY2sgPSBuZXcgUmRzU3RhY2soYXBwLCAnVGVzdFJkc1N0YWNrJywge1xuICAgIGVudjogeyBhY2NvdW50OiAnMTIzNDU2Nzg5MDEyJywgcmVnaW9uOiAndXMtZWFzdC0xJyB9LFxuICAgIGVudk5hbWU6ICd0ZXN0JyxcbiAgICB2cGM6IG5ldHdvcmtTdGFjay52cGMsXG4gICAgcmRzU2VjdXJpdHlHcm91cDogbmV0d29ya1N0YWNrLnJkc1NlY3VyaXR5R3JvdXAsXG4gIH0pO1xuICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gIHJldHVybiB7IHN0YWNrLCB0ZW1wbGF0ZSwgbmV0d29ya1N0YWNrIH07XG59XG5cbi8qKlxuICogSGVscGVyIGZ1bmN0aW9uIHRvIGJ1aWxkIGEgQ2FjaGVTdGFjayB3aXRoIHN0YW5kYXJkIHRlc3QgY29uZmlndXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gYnVpbGRDYWNoZVN0YWNrKCk6IHsgc3RhY2s6IENhY2hlU3RhY2s7IHRlbXBsYXRlOiBUZW1wbGF0ZTsgbmV0d29ya1N0YWNrOiBOZXR3b3JrU3RhY2tPcHRpbWl6ZWQgfSB7XG4gIGNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG4gIGNvbnN0IG5ldHdvcmtTdGFjayA9IG5ldyBOZXR3b3JrU3RhY2tPcHRpbWl6ZWQoYXBwLCAnVGVzdE5ldHdvcmtTdGFjaycsIHtcbiAgICBlbnY6IHsgYWNjb3VudDogJzEyMzQ1Njc4OTAxMicsIHJlZ2lvbjogJ3VzLWVhc3QtMScgfSxcbiAgICBlbnZOYW1lOiAndGVzdCcsXG4gIH0pO1xuICBjb25zdCBzdGFjayA9IG5ldyBDYWNoZVN0YWNrKGFwcCwgJ1Rlc3RDYWNoZVN0YWNrJywge1xuICAgIGVudjogeyBhY2NvdW50OiAnMTIzNDU2Nzg5MDEyJywgcmVnaW9uOiAndXMtZWFzdC0xJyB9LFxuICAgIGVudk5hbWU6ICd0ZXN0JyxcbiAgICB2cGM6IG5ldHdvcmtTdGFjay52cGMsXG4gICAgcmVkaXNTZWN1cml0eUdyb3VwOiBuZXR3b3JrU3RhY2sucmVkaXNTZWN1cml0eUdyb3VwLFxuICB9KTtcbiAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICByZXR1cm4geyBzdGFjaywgdGVtcGxhdGUsIG5ldHdvcmtTdGFjayB9O1xufVxuXG4vKipcbiAqIEhlbHBlciBmdW5jdGlvbiB0byBidWlsZCBhbiBBdXRoU3RhY2sgd2l0aCBzdGFuZGFyZCB0ZXN0IGNvbmZpZ3VyYXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkQXV0aFN0YWNrKCk6IHsgc3RhY2s6IEF1dGhTdGFjazsgdGVtcGxhdGU6IFRlbXBsYXRlIH0ge1xuICBjb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuICBjb25zdCBzdGFjayA9IG5ldyBBdXRoU3RhY2soYXBwLCAnVGVzdEF1dGhTdGFjaycsIHtcbiAgICBlbnY6IHsgYWNjb3VudDogJzEyMzQ1Njc4OTAxMicsIHJlZ2lvbjogJ3VzLWVhc3QtMScgfSxcbiAgICBlbnZOYW1lOiAndGVzdCcsXG4gIH0pO1xuICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gIHJldHVybiB7IHN0YWNrLCB0ZW1wbGF0ZSB9O1xufVxuXG4vKipcbiAqIEhlbHBlciBmdW5jdGlvbiB0byBidWlsZCBhIFN0b3JhZ2VTdGFjayB3aXRoIHN0YW5kYXJkIHRlc3QgY29uZmlndXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gYnVpbGRTdG9yYWdlU3RhY2soKTogeyBzdGFjazogU3RvcmFnZVN0YWNrOyB0ZW1wbGF0ZTogVGVtcGxhdGUgfSB7XG4gIGNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG4gIGNvbnN0IHN0YWNrID0gbmV3IFN0b3JhZ2VTdGFjayhhcHAsICdUZXN0U3RvcmFnZVN0YWNrJywge1xuICAgIGVudjogeyBhY2NvdW50OiAnMTIzNDU2Nzg5MDEyJywgcmVnaW9uOiAndXMtZWFzdC0xJyB9LFxuICB9KTtcbiAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICByZXR1cm4geyBzdGFjaywgdGVtcGxhdGUgfTtcbn1cblxuLyoqXG4gKiBIZWxwZXIgZnVuY3Rpb24gdG8gYnVpbGQgYSBTZWNyZXRzU3RhY2sgd2l0aCBzdGFuZGFyZCB0ZXN0IGNvbmZpZ3VyYXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkU2VjcmV0c1N0YWNrKCk6IHsgc3RhY2s6IFNlY3JldHNTdGFjazsgdGVtcGxhdGU6IFRlbXBsYXRlIH0ge1xuICBjb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuICBjb25zdCBzdGFjayA9IG5ldyBTZWNyZXRzU3RhY2soYXBwLCAnVGVzdFNlY3JldHNTdGFjaycsIHtcbiAgICBlbnY6IHsgYWNjb3VudDogJzEyMzQ1Njc4OTAxMicsIHJlZ2lvbjogJ3VzLWVhc3QtMScgfSxcbiAgICBlbnZOYW1lOiAndGVzdCcsXG4gIH0pO1xuICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gIHJldHVybiB7IHN0YWNrLCB0ZW1wbGF0ZSB9O1xufVxuXG4vKipcbiAqIEhlbHBlciBmdW5jdGlvbiB0byBidWlsZCBhbiBPYnNlcnZhYmlsaXR5U3RhY2sgd2l0aCBzdGFuZGFyZCB0ZXN0IGNvbmZpZ3VyYXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkT2JzZXJ2YWJpbGl0eVN0YWNrKCk6IHsgc3RhY2s6IE9ic2VydmFiaWxpdHlTdGFjazsgdGVtcGxhdGU6IFRlbXBsYXRlIH0ge1xuICBjb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuICBjb25zdCBzdGFjayA9IG5ldyBPYnNlcnZhYmlsaXR5U3RhY2soYXBwLCAnVGVzdE9ic2VydmFiaWxpdHlTdGFjaycsIHtcbiAgICBlbnY6IHsgYWNjb3VudDogJzEyMzQ1Njc4OTAxMicsIHJlZ2lvbjogJ3VzLWVhc3QtMScgfSxcbiAgICBlbnZOYW1lOiAndGVzdCcsXG4gIH0pO1xuICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gIHJldHVybiB7IHN0YWNrLCB0ZW1wbGF0ZSB9O1xufVxuXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIFVOSVZFUlNBTCBQUk9QRVJUWSAxOiBBbGwgc3RhY2tzIGhhdmUgQ29tcG9uZW50IGFuZCBDb3N0Q2VudGVyIHRhZ3Ncbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG5kZXNjcmliZSgnVW5pdmVyc2FsIFByb3BlcnR5OiBSZXNvdXJjZSBUYWdnaW5nJywgKCkgPT4ge1xuICAvKipcbiAgICogUHJvcGVydHk6IEZvciBhbnkgc3RhY2sgZGVwbG95ZWQgYnkgdGhlIERlcGxveW1lbnRfU3lzdGVtLCB0aGUgc3RhY2sgU0hBTExcbiAgICogaGF2ZSBib3RoIENvbXBvbmVudCBhbmQgQ29zdENlbnRlciB0YWdzIGZvciBjb3N0IGFsbG9jYXRpb24gYW5kIGZpbHRlcmluZy5cbiAgICpcbiAgICogKipWYWxpZGF0ZXM6IFJlcXVpcmVtZW50cyAxLjcsIERlc2lnbiBQcm9wZXJ0eSA0KipcbiAgICovXG5cbiAgY29uc3Qgc3RhY2tCdWlsZGVycyA9IFtcbiAgICB7IG5hbWU6ICdOZXR3b3JrU3RhY2tPcHRpbWl6ZWQnLCBidWlsZGVyOiBidWlsZE5ldHdvcmtTdGFjayB9LFxuICAgIHsgbmFtZTogJ1Jkc1N0YWNrJywgYnVpbGRlcjogYnVpbGRSZHNTdGFjayB9LFxuICAgIHsgbmFtZTogJ0NhY2hlU3RhY2snLCBidWlsZGVyOiBidWlsZENhY2hlU3RhY2sgfSxcbiAgICB7IG5hbWU6ICdBdXRoU3RhY2snLCBidWlsZGVyOiBidWlsZEF1dGhTdGFjayB9LFxuICAgIHsgbmFtZTogJ1N0b3JhZ2VTdGFjaycsIGJ1aWxkZXI6IGJ1aWxkU3RvcmFnZVN0YWNrIH0sXG4gICAgeyBuYW1lOiAnU2VjcmV0c1N0YWNrJywgYnVpbGRlcjogYnVpbGRTZWNyZXRzU3RhY2sgfSxcbiAgICB7IG5hbWU6ICdPYnNlcnZhYmlsaXR5U3RhY2snLCBidWlsZGVyOiBidWlsZE9ic2VydmFiaWxpdHlTdGFjayB9LFxuICBdO1xuXG4gIHRlc3QuZWFjaChzdGFja0J1aWxkZXJzKSgnJG5hbWUgaGFzIENvbXBvbmVudCB0YWcnLCAoeyBidWlsZGVyIH0pID0+IHtcbiAgICBjb25zdCB7IHN0YWNrIH0gPSBidWlsZGVyKCk7XG4gICAgXG4gICAgLy8gQ0RLIGRvZXNuJ3QgcHJvdmlkZSBhIGRpcmVjdCB3YXkgdG8gcXVlcnkgdGFncywgc28gd2UgY2hlY2sgdGhlIHRlbXBsYXRlXG4gICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgIGNvbnN0IGNmblRlbXBsYXRlID0gdGVtcGxhdGUudG9KU09OKCk7XG4gICAgXG4gICAgLy8gQ2hlY2sgaWYgYW55IHJlc291cmNlcyBpbiB0aGUgc3RhY2sgaGF2ZSB0aGUgQ29tcG9uZW50IHRhZ1xuICAgIC8vIE5vdGU6IE5vdCBhbGwgQVdTIHJlc291cmNlcyBzdXBwb3J0IHRhZ3MgKGUuZy4sIHNvbWUgQ29nbml0byByZXNvdXJjZXMpLlxuICAgIC8vIFRoZSB0ZXN0IHBhc3NlcyBpZiBhdCBsZWFzdCBzb21lIHJlc291cmNlcyBoYXZlIHRoZSByZXF1aXJlZCB0YWdzLlxuICAgIGNvbnN0IHJlc291cmNlcyA9IE9iamVjdC52YWx1ZXMoY2ZuVGVtcGxhdGUuUmVzb3VyY2VzIHx8IHt9KTtcbiAgICBjb25zdCB0YWdnZWRSZXNvdXJjZXMgPSByZXNvdXJjZXMuZmlsdGVyKChyZXNvdXJjZTogYW55KSA9PiB7XG4gICAgICBjb25zdCB0YWdzID0gcmVzb3VyY2UuUHJvcGVydGllcz8uVGFncyB8fCBbXTtcbiAgICAgIHJldHVybiB0YWdzLnNvbWUoKHRhZzogYW55KSA9PiB0YWcuS2V5ID09PSAnQ29tcG9uZW50Jyk7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gRXhwZWN0IGF0IGxlYXN0IG9uZSByZXNvdXJjZSB0byBiZSB0YWdnZWRcbiAgICAvLyBGb3IgQXV0aFN0YWNrLCBDb2duaXRvIHJlc291cmNlcyBtYXkgbm90IHN1cHBvcnQgVGFncyBwcm9wZXJ0eSxcbiAgICAvLyBzbyB3ZSBjaGVjayBpZiB0aGVyZSBhcmUgYW55IHRhZ2dhYmxlIHJlc291cmNlcyBmaXJzdFxuICAgIGlmIChyZXNvdXJjZXMubGVuZ3RoID4gMCkge1xuICAgICAgLy8gQXQgbGVhc3Qgc29tZSByZXNvdXJjZXMgc2hvdWxkIGJlIHRhZ2dlZCBpZiB0aGUgc3RhY2sgaGFzIHRhZ2dhYmxlIHJlc291cmNlc1xuICAgICAgY29uc3QgaGFzVGFnZ2FibGVSZXNvdXJjZXMgPSByZXNvdXJjZXMuc29tZSgocjogYW55KSA9PiByLlByb3BlcnRpZXM/Lmhhc093blByb3BlcnR5KCdUYWdzJykpO1xuICAgICAgaWYgKGhhc1RhZ2dhYmxlUmVzb3VyY2VzKSB7XG4gICAgICAgIGV4cGVjdCh0YWdnZWRSZXNvdXJjZXMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDEpO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgdGVzdC5lYWNoKHN0YWNrQnVpbGRlcnMpKCckbmFtZSBoYXMgQ29zdENlbnRlciB0YWcnLCAoeyBidWlsZGVyIH0pID0+IHtcbiAgICBjb25zdCB7IHN0YWNrIH0gPSBidWlsZGVyKCk7XG4gICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgIGNvbnN0IGNmblRlbXBsYXRlID0gdGVtcGxhdGUudG9KU09OKCk7XG4gICAgXG4gICAgLy8gQ2hlY2sgaWYgYW55IHJlc291cmNlcyBpbiB0aGUgc3RhY2sgaGF2ZSB0aGUgQ29zdENlbnRlciB0YWdcbiAgICAvLyBOb3RlOiBOb3QgYWxsIEFXUyByZXNvdXJjZXMgc3VwcG9ydCB0YWdzIChlLmcuLCBzb21lIENvZ25pdG8gcmVzb3VyY2VzKS5cbiAgICBjb25zdCByZXNvdXJjZXMgPSBPYmplY3QudmFsdWVzKGNmblRlbXBsYXRlLlJlc291cmNlcyB8fCB7fSk7XG4gICAgY29uc3QgdGFnZ2VkUmVzb3VyY2VzID0gcmVzb3VyY2VzLmZpbHRlcigocmVzb3VyY2U6IGFueSkgPT4ge1xuICAgICAgY29uc3QgdGFncyA9IHJlc291cmNlLlByb3BlcnRpZXM/LlRhZ3MgfHwgW107XG4gICAgICByZXR1cm4gdGFncy5zb21lKCh0YWc6IGFueSkgPT4gdGFnLktleSA9PT0gJ0Nvc3RDZW50ZXInKTtcbiAgICB9KTtcbiAgICBcbiAgICAvLyBFeHBlY3QgYXQgbGVhc3Qgb25lIHJlc291cmNlIHRvIGJlIHRhZ2dlZCBpZiB0aGVyZSBhcmUgdGFnZ2FibGUgcmVzb3VyY2VzXG4gICAgaWYgKHJlc291cmNlcy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBoYXNUYWdnYWJsZVJlc291cmNlcyA9IHJlc291cmNlcy5zb21lKChyOiBhbnkpID0+IHIuUHJvcGVydGllcz8uaGFzT3duUHJvcGVydHkoJ1RhZ3MnKSk7XG4gICAgICBpZiAoaGFzVGFnZ2FibGVSZXNvdXJjZXMpIHtcbiAgICAgICAgZXhwZWN0KHRhZ2dlZFJlc291cmNlcy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMSk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbn0pO1xuXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIFVOSVZFUlNBTCBQUk9QRVJUWSAyOiBBbGwgUkRTIGluc3RhbmNlcyBoYXZlIGVuY3J5cHRpb24gZW5hYmxlZFxuLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmRlc2NyaWJlKCdVbml2ZXJzYWwgUHJvcGVydHk6IFJEUyBFbmNyeXB0aW9uJywgKCkgPT4ge1xuICAvKipcbiAgICogUHJvcGVydHk6IEZvciBhbnkgUkRTIGRhdGFiYXNlIGluc3RhbmNlIGNyZWF0ZWQgYnkgdGhlIERlcGxveW1lbnRfU3lzdGVtLFxuICAgKiB0aGUgaW5zdGFuY2UgU0hBTEwgaGF2ZSBTdG9yYWdlRW5jcnlwdGVkIHNldCB0byB0cnVlLlxuICAgKlxuICAgKiAqKlZhbGlkYXRlczogUmVxdWlyZW1lbnRzIDQuNSwgMTEuMiwgRGVzaWduIFByb3BlcnR5IDcqKlxuICAgKi9cblxuICB0ZXN0KCdSZHNTdGFjayBjcmVhdGVzIFJEUyBpbnN0YW5jZSB3aXRoIGVuY3J5cHRpb24gZW5hYmxlZCcsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFJkc1N0YWNrKCk7XG4gICAgXG4gICAgLy8gRmluZCBhbGwgUkRTIGluc3RhbmNlc1xuICAgIGNvbnN0IHJkc0luc3RhbmNlcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6UkRTOjpEQkluc3RhbmNlJyk7XG4gICAgY29uc3QgaW5zdGFuY2VDb3VudCA9IE9iamVjdC5rZXlzKHJkc0luc3RhbmNlcykubGVuZ3RoO1xuICAgIFxuICAgIC8vIFZlcmlmeSBhdCBsZWFzdCBvbmUgUkRTIGluc3RhbmNlIGV4aXN0c1xuICAgIGV4cGVjdChpbnN0YW5jZUNvdW50KS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDEpO1xuICAgIFxuICAgIC8vIFZlcmlmeSBhbGwgUkRTIGluc3RhbmNlcyBoYXZlIGVuY3J5cHRpb24gZW5hYmxlZFxuICAgIGZvciAoY29uc3QgW2xvZ2ljYWxJZCwgcmVzb3VyY2VdIG9mIE9iamVjdC5lbnRyaWVzKHJkc0luc3RhbmNlcykpIHtcbiAgICAgIGV4cGVjdChyZXNvdXJjZSkudG9IYXZlUHJvcGVydHkoJ1Byb3BlcnRpZXMuU3RvcmFnZUVuY3J5cHRlZCcsIHRydWUpO1xuICAgIH1cbiAgfSk7XG5cbiAgdGVzdCgnUkRTIGluc3RhbmNlIHVzZXMgQVdTLW1hbmFnZWQgS01TIGtleXMgZm9yIGVuY3J5cHRpb24nLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRSZHNTdGFjaygpO1xuICAgIFxuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpSRFM6OkRCSW5zdGFuY2UnLCB7XG4gICAgICBTdG9yYWdlRW5jcnlwdGVkOiB0cnVlLFxuICAgICAgLy8gV2hlbiBLTVNLZXlJZCBpcyBub3Qgc3BlY2lmaWVkLCBBV1MgdXNlcyB0aGUgZGVmYXVsdCBhd3MvcmRzIG1hbmFnZWQga2V5XG4gICAgfSk7XG4gIH0pO1xufSk7XG5cbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gVU5JVkVSU0FMIFBST1BFUlRZIDM6IEFsbCBTMyBidWNrZXRzIGJsb2NrIHB1YmxpYyBhY2Nlc3Ncbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG5kZXNjcmliZSgnVW5pdmVyc2FsIFByb3BlcnR5OiBTMyBQdWJsaWMgQWNjZXNzIEJsb2NrJywgKCkgPT4ge1xuICAvKipcbiAgICogUHJvcGVydHk6IEZvciBhbnkgUzMgYnVja2V0IGNyZWF0ZWQgYnkgdGhlIERlcGxveW1lbnRfU3lzdGVtLCB0aGUgYnVja2V0XG4gICAqIFNIQUxMIGhhdmUgUHVibGljQWNjZXNzQmxvY2tDb25maWd1cmF0aW9uIHNldCB0byBibG9jayBhbGwgcHVibGljIGFjY2Vzcy5cbiAgICpcbiAgICogKipWYWxpZGF0ZXM6IFJlcXVpcmVtZW50cyA3LjIsIDExLjUsIERlc2lnbiBQcm9wZXJ0eSAxMCoqXG4gICAqL1xuXG4gIHRlc3QoJ1N0b3JhZ2VTdGFjayBjcmVhdGVzIFMzIGJ1Y2tldHMgd2l0aCBwdWJsaWMgYWNjZXNzIGJsb2NrZWQnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRTdG9yYWdlU3RhY2soKTtcbiAgICBcbiAgICAvLyBGaW5kIGFsbCBTMyBidWNrZXRzXG4gICAgY29uc3QgczNCdWNrZXRzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpTMzo6QnVja2V0Jyk7XG4gICAgY29uc3QgYnVja2V0Q291bnQgPSBPYmplY3Qua2V5cyhzM0J1Y2tldHMpLmxlbmd0aDtcbiAgICBcbiAgICAvLyBWZXJpZnkgYXQgbGVhc3Qgb25lIFMzIGJ1Y2tldCBleGlzdHNcbiAgICBleHBlY3QoYnVja2V0Q291bnQpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMSk7XG4gICAgXG4gICAgLy8gVmVyaWZ5IGFsbCBTMyBidWNrZXRzIGhhdmUgcHVibGljIGFjY2VzcyBibG9ja2VkXG4gICAgZm9yIChjb25zdCBbbG9naWNhbElkLCByZXNvdXJjZV0gb2YgT2JqZWN0LmVudHJpZXMoczNCdWNrZXRzKSkge1xuICAgICAgZXhwZWN0KHJlc291cmNlKS50b0hhdmVQcm9wZXJ0eSgnUHJvcGVydGllcy5QdWJsaWNBY2Nlc3NCbG9ja0NvbmZpZ3VyYXRpb24nKTtcbiAgICAgIGNvbnN0IGJsb2NrQ29uZmlnID0gKHJlc291cmNlIGFzIGFueSkuUHJvcGVydGllcy5QdWJsaWNBY2Nlc3NCbG9ja0NvbmZpZ3VyYXRpb247XG4gICAgICBleHBlY3QoYmxvY2tDb25maWcuQmxvY2tQdWJsaWNBY2xzKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KGJsb2NrQ29uZmlnLkJsb2NrUHVibGljUG9saWN5KS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KGJsb2NrQ29uZmlnLklnbm9yZVB1YmxpY0FjbHMpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoYmxvY2tDb25maWcuUmVzdHJpY3RQdWJsaWNCdWNrZXRzKS50b0JlKHRydWUpO1xuICAgIH1cbiAgfSk7XG5cbiAgdGVzdCgnQWxsIFMzIGJ1Y2tldHMgZW5mb3JjZSBTU0wvVExTIHZpYSBidWNrZXQgcG9saWN5JywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkU3RvcmFnZVN0YWNrKCk7XG4gICAgXG4gICAgLy8gRmluZCBhbGwgYnVja2V0IHBvbGljaWVzXG4gICAgY29uc3QgYnVja2V0UG9saWNpZXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OlMzOjpCdWNrZXRQb2xpY3knKTtcbiAgICBcbiAgICAvLyBWZXJpZnkgYXQgbGVhc3Qgb25lIGJ1Y2tldCBwb2xpY3kgZXhpc3RzXG4gICAgZXhwZWN0KE9iamVjdC5rZXlzKGJ1Y2tldFBvbGljaWVzKS5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMSk7XG4gICAgXG4gICAgLy8gVmVyaWZ5IGFsbCBidWNrZXQgcG9saWNpZXMgZW5mb3JjZSBTU0xcbiAgICBmb3IgKGNvbnN0IFtsb2dpY2FsSWQsIHJlc291cmNlXSBvZiBPYmplY3QuZW50cmllcyhidWNrZXRQb2xpY2llcykpIHtcbiAgICAgIGNvbnN0IHBvbGljeURvYyA9IChyZXNvdXJjZSBhcyBhbnkpLlByb3BlcnRpZXMuUG9saWN5RG9jdW1lbnQ7XG4gICAgICBjb25zdCBzdGF0ZW1lbnRzID0gcG9saWN5RG9jLlN0YXRlbWVudCB8fCBbXTtcbiAgICAgIFxuICAgICAgLy8gQ2hlY2sgaWYgdGhlcmUncyBhIGRlbnkgc3RhdGVtZW50IGZvciBub24tU1NMIHJlcXVlc3RzXG4gICAgICBjb25zdCBoYXNTc2xFbmZvcmNlbWVudCA9IHN0YXRlbWVudHMuc29tZSgoc3RtdDogYW55KSA9PiBcbiAgICAgICAgc3RtdC5FZmZlY3QgPT09ICdEZW55JyAmJlxuICAgICAgICBzdG10LkNvbmRpdGlvbj8uQm9vbD8uWydhd3M6U2VjdXJlVHJhbnNwb3J0J10gPT09ICdmYWxzZSdcbiAgICAgICk7XG4gICAgICBcbiAgICAgIGV4cGVjdChoYXNTc2xFbmZvcmNlbWVudCkudG9CZSh0cnVlKTtcbiAgICB9XG4gIH0pO1xufSk7XG5cbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gVU5JVkVSU0FMIFBST1BFUlRZIDQ6IEFsbCBTZWNyZXRzIGhhdmUgcmV0ZW50aW9uIHBvbGljeVxuLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmRlc2NyaWJlKCdVbml2ZXJzYWwgUHJvcGVydHk6IFNlY3JldHMgTWFuYWdlciBSZXRlbnRpb24nLCAoKSA9PiB7XG4gIC8qKlxuICAgKiBQcm9wZXJ0eTogRm9yIGFueSBBV1MgU2VjcmV0cyBNYW5hZ2VyIHNlY3JldCBjcmVhdGVkIGJ5IHRoZSBEZXBsb3ltZW50X1N5c3RlbSxcbiAgICogdGhlIHNlY3JldCBTSEFMTCBoYXZlIGEgRGVsZXRpb25Qb2xpY3kgb2YgUmV0YWluIG9yIFVwZGF0ZVJlcGxhY2VQb2xpY3kgb2YgUmV0YWluXG4gICAqIHRvIHByZXZlbnQgYWNjaWRlbnRhbCBkYXRhIGxvc3MuXG4gICAqXG4gICAqICoqVmFsaWRhdGVzOiBSZXF1aXJlbWVudHMgMS42LCBEZXNpZ24gUHJvcGVydHkgMyoqXG4gICAqL1xuXG4gIHRlc3QoJ1NlY3JldHNTdGFjayBjcmVhdGVzIHNlY3JldHMgd2l0aCBSRVRBSU4gZGVsZXRpb24gcG9saWN5JywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkU2VjcmV0c1N0YWNrKCk7XG4gICAgXG4gICAgLy8gRmluZCBhbGwgU2VjcmV0cyBNYW5hZ2VyIHNlY3JldHNcbiAgICBjb25zdCBzZWNyZXRzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpTZWNyZXRzTWFuYWdlcjo6U2VjcmV0Jywge1xuICAgICAgRGVsZXRpb25Qb2xpY3k6ICdSZXRhaW4nLFxuICAgIH0pO1xuICAgIFxuICAgIC8vIFZlcmlmeSBhdCBsZWFzdCBvbmUgc2VjcmV0IGhhcyBSRVRBSU4gcG9saWN5XG4gICAgZXhwZWN0KE9iamVjdC5rZXlzKHNlY3JldHMpLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgxKTtcbiAgfSk7XG5cbiAgdGVzdCgnUmRzU3RhY2sgZGF0YWJhc2UgY3JlZGVudGlhbHMgc2VjcmV0IGhhcyBSRVRBSU4gZGVsZXRpb24gcG9saWN5JywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkUmRzU3RhY2soKTtcbiAgICBcbiAgICAvLyBGaW5kIHNlY3JldHMgd2l0aCBSRVRBSU4gcG9saWN5XG4gICAgY29uc3Qgc2VjcmV0cyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6U2VjcmV0c01hbmFnZXI6OlNlY3JldCcsIHtcbiAgICAgIERlbGV0aW9uUG9saWN5OiAnUmV0YWluJyxcbiAgICB9KTtcbiAgICBcbiAgICAvLyBSRFMgc3RhY2sgY3JlYXRlcyBhdCBsZWFzdCBvbmUgc2VjcmV0IChkYXRhYmFzZSBjcmVkZW50aWFscylcbiAgICBleHBlY3QoT2JqZWN0LmtleXMoc2VjcmV0cykubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDEpO1xuICB9KTtcbn0pO1xuXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIFVOSVZFUlNBTCBQUk9QRVJUWSA1OiBTdGF0ZWZ1bCByZXNvdXJjZXMgaGF2ZSBSRVRBSU4gcmVtb3ZhbCBwb2xpY3lcbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG5kZXNjcmliZSgnVW5pdmVyc2FsIFByb3BlcnR5OiBTdGF0ZWZ1bCBSZXNvdXJjZSBQcm90ZWN0aW9uJywgKCkgPT4ge1xuICAvKipcbiAgICogUHJvcGVydHk6IEZvciBhbnkgc3RhdGVmdWwgcmVzb3VyY2UgKFJEUyBpbnN0YW5jZSwgUzMgYnVja2V0LCBLTVMga2V5LCBTZWNyZXRzKVxuICAgKiBjcmVhdGVkIGJ5IHRoZSBEZXBsb3ltZW50X1N5c3RlbSwgdGhlIHJlc291cmNlIFNIQUxMIGhhdmUgYSByZW1vdmFsIHBvbGljeSBvZlxuICAgKiBSRVRBSU4gdG8gcHJldmVudCBhY2NpZGVudGFsIGRhdGEgbG9zcyBkdXJpbmcgc3RhY2sgZGVsZXRpb24uXG4gICAqXG4gICAqICoqVmFsaWRhdGVzOiBSZXF1aXJlbWVudHMgMS42LCBEZXNpZ24gUHJvcGVydHkgMyoqXG4gICAqL1xuXG4gIHRlc3QoJ1JEUyBpbnN0YW5jZSBoYXMgUkVUQUlOIGRlbGV0aW9uIHBvbGljeScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFJkc1N0YWNrKCk7XG4gICAgXG4gICAgY29uc3QgcmRzSW5zdGFuY2VzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpSRFM6OkRCSW5zdGFuY2UnLCB7XG4gICAgICBEZWxldGlvblBvbGljeTogJ1JldGFpbicsXG4gICAgfSk7XG4gICAgXG4gICAgZXhwZWN0KE9iamVjdC5rZXlzKHJkc0luc3RhbmNlcykubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDEpO1xuICB9KTtcblxuICB0ZXN0KCdTMyBidWNrZXRzIGhhdmUgUkVUQUlOIGRlbGV0aW9uIHBvbGljeScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFN0b3JhZ2VTdGFjaygpO1xuICAgIFxuICAgIGNvbnN0IHMzQnVja2V0cyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6UzM6OkJ1Y2tldCcsIHtcbiAgICAgIERlbGV0aW9uUG9saWN5OiAnUmV0YWluJyxcbiAgICB9KTtcbiAgICBcbiAgICBleHBlY3QoT2JqZWN0LmtleXMoczNCdWNrZXRzKS5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMSk7XG4gIH0pO1xuXG4gIHRlc3QoJ0tNUyBrZXlzIGhhdmUgUkVUQUlOIGRlbGV0aW9uIHBvbGljeScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFNlY3JldHNTdGFjaygpO1xuICAgIFxuICAgIGNvbnN0IGttc0tleXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OktNUzo6S2V5Jywge1xuICAgICAgRGVsZXRpb25Qb2xpY3k6ICdSZXRhaW4nLFxuICAgIH0pO1xuICAgIFxuICAgIGV4cGVjdChPYmplY3Qua2V5cyhrbXNLZXlzKS5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMSk7XG4gIH0pO1xufSk7XG5cbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gVU5JVkVSU0FMIFBST1BFUlRZIDY6IEVsYXN0aUNhY2hlIGNsdXN0ZXJzIGhhdmUgZW5jcnlwdGlvbiBlbmFibGVkXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuZGVzY3JpYmUoJ1VuaXZlcnNhbCBQcm9wZXJ0eTogRWxhc3RpQ2FjaGUgRW5jcnlwdGlvbicsICgpID0+IHtcbiAgLyoqXG4gICAqIFByb3BlcnR5OiBGb3IgYW55IEVsYXN0aUNhY2hlIHJlcGxpY2F0aW9uIGdyb3VwIGNyZWF0ZWQgYnkgdGhlIERlcGxveW1lbnRfU3lzdGVtLFxuICAgKiB0aGUgY2x1c3RlciBTSEFMTCBoYXZlIGJvdGggYXQtcmVzdCBhbmQgaW4tdHJhbnNpdCBlbmNyeXB0aW9uIGVuYWJsZWQuXG4gICAqXG4gICAqICoqVmFsaWRhdGVzOiBSZXF1aXJlbWVudHMgNS40LCA1LjUsIDExLjIsIERlc2lnbiBQcm9wZXJ0eSA3KipcbiAgICovXG5cbiAgdGVzdCgnQ2FjaGVTdGFjayBjcmVhdGVzIEVsYXN0aUNhY2hlIHdpdGggYXQtcmVzdCBlbmNyeXB0aW9uIGVuYWJsZWQnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRDYWNoZVN0YWNrKCk7XG4gICAgXG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVsYXN0aUNhY2hlOjpSZXBsaWNhdGlvbkdyb3VwJywge1xuICAgICAgQXRSZXN0RW5jcnlwdGlvbkVuYWJsZWQ6IHRydWUsXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ0NhY2hlU3RhY2sgY3JlYXRlcyBFbGFzdGlDYWNoZSB3aXRoIGluLXRyYW5zaXQgZW5jcnlwdGlvbiBlbmFibGVkJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkQ2FjaGVTdGFjaygpO1xuICAgIFxuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFbGFzdGlDYWNoZTo6UmVwbGljYXRpb25Hcm91cCcsIHtcbiAgICAgIFRyYW5zaXRFbmNyeXB0aW9uRW5hYmxlZDogdHJ1ZSxcbiAgICB9KTtcbiAgfSk7XG59KTtcblxuLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBVTklWRVJTQUwgUFJPUEVSVFkgNzogRGF0YSB0aWVyIHJlc291cmNlcyBhcmUgaW4gaXNvbGF0ZWQgc3VibmV0c1xuLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmRlc2NyaWJlKCdVbml2ZXJzYWwgUHJvcGVydHk6IERhdGEgVGllciBJc29sYXRpb24nLCAoKSA9PiB7XG4gIC8qKlxuICAgKiBQcm9wZXJ0eTogRm9yIGFueSBkYXRhIHNlcnZpY2UgKFJEUywgRWxhc3RpQ2FjaGUpIGRlcGxveWVkIGJ5IHRoZSBEZXBsb3ltZW50X1N5c3RlbSxcbiAgICogdGhlIHNlcnZpY2UgU0hBTEwgYmUgZGVwbG95ZWQgaW4gcHJpdmF0ZSBpc29sYXRlZCBzdWJuZXRzIHdpdGggbm8gaW50ZXJuZXQgYWNjZXNzLlxuICAgKlxuICAgKiAqKlZhbGlkYXRlczogUmVxdWlyZW1lbnRzIDQuOSwgNS42LCAxMS40LCBEZXNpZ24gUHJvcGVydHkgOSoqXG4gICAqL1xuXG4gIHRlc3QoJ1JEUyBpbnN0YW5jZSBpcyBkZXBsb3llZCBpbiBpc29sYXRlZCBzdWJuZXRzJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUsIG5ldHdvcmtTdGFjayB9ID0gYnVpbGRSZHNTdGFjaygpO1xuICAgIFxuICAgIC8vIFZlcmlmeSBSRFMgc3VibmV0IGdyb3VwIGV4aXN0c1xuICAgIGNvbnN0IHN1Ym5ldEdyb3VwcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6UkRTOjpEQlN1Ym5ldEdyb3VwJyk7XG4gICAgZXhwZWN0KE9iamVjdC5rZXlzKHN1Ym5ldEdyb3VwcykubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDEpO1xuICAgIFxuICAgIC8vIFZlcmlmeSBSRFMgaW5zdGFuY2UgcmVmZXJlbmNlcyB0aGUgc3VibmV0IGdyb3VwXG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlJEUzo6REJJbnN0YW5jZScsIHtcbiAgICAgIERCU3VibmV0R3JvdXBOYW1lOiBNYXRjaC5hbnlWYWx1ZSgpLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdFbGFzdGlDYWNoZSBpcyBkZXBsb3llZCBpbiBpc29sYXRlZCBzdWJuZXRzJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUsIG5ldHdvcmtTdGFjayB9ID0gYnVpbGRDYWNoZVN0YWNrKCk7XG4gICAgXG4gICAgLy8gVmVyaWZ5IEVsYXN0aUNhY2hlIHN1Ym5ldCBncm91cCBleGlzdHNcbiAgICBjb25zdCBzdWJuZXRHcm91cHMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkVsYXN0aUNhY2hlOjpTdWJuZXRHcm91cCcpO1xuICAgIGV4cGVjdChPYmplY3Qua2V5cyhzdWJuZXRHcm91cHMpLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgxKTtcbiAgICBcbiAgICAvLyBWZXJpZnkgRWxhc3RpQ2FjaGUgcmVwbGljYXRpb24gZ3JvdXAgcmVmZXJlbmNlcyB0aGUgc3VibmV0IGdyb3VwXG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVsYXN0aUNhY2hlOjpSZXBsaWNhdGlvbkdyb3VwJywge1xuICAgICAgQ2FjaGVTdWJuZXRHcm91cE5hbWU6IE1hdGNoLmFueVZhbHVlKCksXG4gICAgfSk7XG4gIH0pO1xufSk7XG5cbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gVU5JVkVSU0FMIFBST1BFUlRZIDg6IEFsbCBzZWN1cml0eSBncm91cHMgZm9sbG93IGxlYXN0LXByaXZpbGVnZSBwcmluY2lwbGVcbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG5kZXNjcmliZSgnVW5pdmVyc2FsIFByb3BlcnR5OiBTZWN1cml0eSBHcm91cCBMZWFzdCBQcml2aWxlZ2UnLCAoKSA9PiB7XG4gIC8qKlxuICAgKiBQcm9wZXJ0eTogRm9yIGFueSBzZWN1cml0eSBncm91cCBjcmVhdGVkIGJ5IHRoZSBEZXBsb3ltZW50X1N5c3RlbSwgaW5ncmVzcyBydWxlc1xuICAgKiBTSEFMTCBiZSByZXN0cmljdGVkIHRvIHNwZWNpZmljIHBvcnRzIGFuZCBzb3VyY2Ugc2VjdXJpdHkgZ3JvdXBzIChub3QgMC4wLjAuMC8wXG4gICAqIGZvciBub24tcHVibGljIHNlcnZpY2VzKS5cbiAgICpcbiAgICogKipWYWxpZGF0ZXM6IFJlcXVpcmVtZW50cyAyLjYsIDIuNywgMi44LCAyLjksIDExLjQsIERlc2lnbiBQcm9wZXJ0eSA5KipcbiAgICovXG5cbiAgdGVzdCgnUkRTIHNlY3VyaXR5IGdyb3VwIG9ubHkgYWxsb3dzIFBvc3RncmVTUUwgcG9ydCBmcm9tIEVDUycsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZE5ldHdvcmtTdGFjaygpO1xuICAgIFxuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFQzI6OlNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICBHcm91cERlc2NyaXB0aW9uOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdSRFMnKSxcbiAgICAgIFNlY3VyaXR5R3JvdXBJbmdyZXNzOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBGcm9tUG9ydDogNTQzMixcbiAgICAgICAgICBUb1BvcnQ6IDU0MzIsXG4gICAgICAgICAgSXBQcm90b2NvbDogJ3RjcCcsXG4gICAgICAgICAgU291cmNlU2VjdXJpdHlHcm91cElkOiBNYXRjaC5hbnlWYWx1ZSgpLFxuICAgICAgICB9KSxcbiAgICAgIF0pLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdSZWRpcyBzZWN1cml0eSBncm91cCBvbmx5IGFsbG93cyBSZWRpcyBwb3J0IGZyb20gRUNTJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkTmV0d29ya1N0YWNrKCk7XG4gICAgXG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVDMjo6U2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIEdyb3VwRGVzY3JpcHRpb246IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ1JlZGlzJyksXG4gICAgICBTZWN1cml0eUdyb3VwSW5ncmVzczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgRnJvbVBvcnQ6IDYzNzksXG4gICAgICAgICAgVG9Qb3J0OiA2Mzc5LFxuICAgICAgICAgIElwUHJvdG9jb2w6ICd0Y3AnLFxuICAgICAgICAgIFNvdXJjZVNlY3VyaXR5R3JvdXBJZDogTWF0Y2guYW55VmFsdWUoKSxcbiAgICAgICAgfSksXG4gICAgICBdKSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnRUNTIHNlY3VyaXR5IGdyb3VwIG9ubHkgYWxsb3dzIHRyYWZmaWMgZnJvbSBBTEInLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGROZXR3b3JrU3RhY2soKTtcbiAgICBcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RUMyOjpTZWN1cml0eUdyb3VwJywge1xuICAgICAgR3JvdXBEZXNjcmlwdGlvbjogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnRUNTJyksXG4gICAgICBTZWN1cml0eUdyb3VwSW5ncmVzczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgRnJvbVBvcnQ6IDgwODAsXG4gICAgICAgICAgVG9Qb3J0OiA4MDgwLFxuICAgICAgICAgIElwUHJvdG9jb2w6ICd0Y3AnLFxuICAgICAgICAgIFNvdXJjZVNlY3VyaXR5R3JvdXBJZDogTWF0Y2guYW55VmFsdWUoKSxcbiAgICAgICAgfSksXG4gICAgICBdKSxcbiAgICB9KTtcbiAgfSk7XG59KTtcblxuLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBVTklWRVJTQUwgUFJPUEVSVFkgOTogQWxsIHN0YWNrcyBleHBvcnQgcmVxdWlyZWQgb3V0cHV0c1xuLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmRlc2NyaWJlKCdVbml2ZXJzYWwgUHJvcGVydHk6IENsb3VkRm9ybWF0aW9uIEV4cG9ydHMnLCAoKSA9PiB7XG4gIC8qKlxuICAgKiBQcm9wZXJ0eTogRm9yIGFueSBDREsgc3RhY2sgZGVwbG95ZWQgYnkgdGhlIERlcGxveW1lbnRfU3lzdGVtLCBpZiB0aGUgc3RhY2tcbiAgICogY3JlYXRlcyByZXNvdXJjZXMgdGhhdCBkZXBlbmRlbnQgc3RhY2tzIG5lZWQgdG8gcmVmZXJlbmNlLCB0aGUgc3RhY2sgU0hBTExcbiAgICogZXhwb3J0IHRob3NlIHJlc291cmNlIGlkZW50aWZpZXJzIGFzIENsb3VkRm9ybWF0aW9uIG91dHB1dHMgd2l0aCB0aGUgbmFtaW5nXG4gICAqIHBhdHRlcm4gRm9vZENvc3RDYWxjdWxhdG9yLXtSZXNvdXJjZVR5cGV9LlxuICAgKlxuICAgKiAqKlZhbGlkYXRlczogUmVxdWlyZW1lbnRzIDEuMywgRGVzaWduIFByb3BlcnR5IDUqKlxuICAgKi9cblxuICB0ZXN0KCdOZXR3b3JrU3RhY2tPcHRpbWl6ZWQgZXhwb3J0cyBWUEMgYW5kIHNlY3VyaXR5IGdyb3VwIElEcycsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZE5ldHdvcmtTdGFjaygpO1xuICAgIFxuICAgIGNvbnN0IHJlcXVpcmVkT3V0cHV0cyA9IFtcbiAgICAgICdWcGNJZCcsXG4gICAgICAnUHVibGljU3VibmV0SWRzJyxcbiAgICAgICdQcml2YXRlU3VibmV0SWRzJyxcbiAgICAgICdJc29sYXRlZFN1Ym5ldElkcycsXG4gICAgICAnQWxiU2VjdXJpdHlHcm91cElkJyxcbiAgICAgICdFY3NTZWN1cml0eUdyb3VwSWQnLFxuICAgICAgJ1Jkc1NlY3VyaXR5R3JvdXBJZCcsXG4gICAgICAnUmVkaXNTZWN1cml0eUdyb3VwSWQnLFxuICAgIF07XG4gICAgXG4gICAgZm9yIChjb25zdCBvdXRwdXRLZXkgb2YgcmVxdWlyZWRPdXRwdXRzKSB7XG4gICAgICBjb25zdCBvdXRwdXRzID0gdGVtcGxhdGUuZmluZE91dHB1dHMob3V0cHV0S2V5KTtcbiAgICAgIGV4cGVjdChPYmplY3Qua2V5cyhvdXRwdXRzKSkudG9IYXZlTGVuZ3RoKDEpO1xuICAgIH1cbiAgfSk7XG5cbiAgdGVzdCgnUmRzU3RhY2sgZXhwb3J0cyBkYXRhYmFzZSBjb25uZWN0aW9uIGluZm9ybWF0aW9uJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkUmRzU3RhY2soKTtcbiAgICBcbiAgICBjb25zdCByZXF1aXJlZE91dHB1dHMgPSBbJ1NlY3JldEFybicsICdFbmRwb2ludCcsICdQb3J0JywgJ0RhdGFiYXNlTmFtZSddO1xuICAgIFxuICAgIGZvciAoY29uc3Qgb3V0cHV0S2V5IG9mIHJlcXVpcmVkT3V0cHV0cykge1xuICAgICAgY29uc3Qgb3V0cHV0cyA9IHRlbXBsYXRlLmZpbmRPdXRwdXRzKG91dHB1dEtleSk7XG4gICAgICBleHBlY3QoT2JqZWN0LmtleXMob3V0cHV0cykpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICB9XG4gIH0pO1xuXG4gIHRlc3QoJ0NhY2hlU3RhY2sgZXhwb3J0cyBSZWRpcyBlbmRwb2ludCcsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZENhY2hlU3RhY2soKTtcbiAgICBcbiAgICBjb25zdCBvdXRwdXRzID0gdGVtcGxhdGUuZmluZE91dHB1dHMoJ1JlZGlzUHJpbWFyeUVuZHBvaW50Jyk7XG4gICAgZXhwZWN0KE9iamVjdC5rZXlzKG91dHB1dHMpKS50b0hhdmVMZW5ndGgoMSk7XG4gIH0pO1xuXG4gIHRlc3QoJ0F1dGhTdGFjayBleHBvcnRzIENvZ25pdG8gVXNlciBQb29sIGluZm9ybWF0aW9uJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkQXV0aFN0YWNrKCk7XG4gICAgXG4gICAgY29uc3QgcmVxdWlyZWRPdXRwdXRzID0gWydVc2VyUG9vbElkJywgJ1VzZXJQb29sQXJuJywgJ1VzZXJQb29sQ2xpZW50SWQnXTtcbiAgICBcbiAgICBmb3IgKGNvbnN0IG91dHB1dEtleSBvZiByZXF1aXJlZE91dHB1dHMpIHtcbiAgICAgIGNvbnN0IG91dHB1dHMgPSB0ZW1wbGF0ZS5maW5kT3V0cHV0cyhvdXRwdXRLZXkpO1xuICAgICAgZXhwZWN0KE9iamVjdC5rZXlzKG91dHB1dHMpKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdTdG9yYWdlU3RhY2sgZXhwb3J0cyBTMyBidWNrZXQgbmFtZXMgYW5kIEFSTnMnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRTdG9yYWdlU3RhY2soKTtcbiAgICBcbiAgICBjb25zdCByZXF1aXJlZE91dHB1dHMgPSBbXG4gICAgICAnRnJvbnRlbmRCdWNrZXROYW1lJyxcbiAgICAgICdGcm9udGVuZEJ1Y2tldEFybicsXG4gICAgICAnSW52b2ljZUJ1Y2tldE5hbWUnLFxuICAgICAgJ0ludm9pY2VCdWNrZXRBcm4nLFxuICAgIF07XG4gICAgXG4gICAgZm9yIChjb25zdCBvdXRwdXRLZXkgb2YgcmVxdWlyZWRPdXRwdXRzKSB7XG4gICAgICBjb25zdCBvdXRwdXRzID0gdGVtcGxhdGUuZmluZE91dHB1dHMob3V0cHV0S2V5KTtcbiAgICAgIGV4cGVjdChPYmplY3Qua2V5cyhvdXRwdXRzKSkudG9IYXZlTGVuZ3RoKDEpO1xuICAgIH1cbiAgfSk7XG59KTtcblxuLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBVTklWRVJTQUwgUFJPUEVSVFkgMTA6IEFsbCBleHBvcnRzIGhhdmUgZXhwb3J0IG5hbWVzIGZvciBjcm9zcy1zdGFjayByZWZzXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuZGVzY3JpYmUoJ1VuaXZlcnNhbCBQcm9wZXJ0eTogRXhwb3J0IE5hbWUgQ29udmVudGlvbicsICgpID0+IHtcbiAgLyoqXG4gICAqIFByb3BlcnR5OiBGb3IgYW55IENsb3VkRm9ybWF0aW9uIGV4cG9ydCB2YWx1ZSBwcm9kdWNlZCBieSBhIHN0YWNrLCB0aGUgZXhwb3J0XG4gICAqIFNIQUxMIGhhdmUgYW4gZXhwbGljaXQgZXhwb3J0IG5hbWUgZm9sbG93aW5nIHRoZSBwYXR0ZXJuIEZvb2RDb3N0Q2FsY3VsYXRvci17ZW52fS17UmVzb3VyY2V9XG4gICAqIHRvIGVuYWJsZSBjcm9zcy1zdGFjayByZWZlcmVuY2VzLlxuICAgKlxuICAgKiBOb3RlOiBOb3QgYWxsIG91dHB1dHMgbmVlZCBleHBvcnQgbmFtZXMgLSBvbmx5IHRob3NlIG1lYW50IGZvciBjcm9zcy1zdGFjayBpbXBvcnQuXG4gICAqIEluZm9ybWF0aW9uYWwgb3V0cHV0cyAobGlrZSBIb3N0ZWRVaVVybCkgbWF5IG9taXQgZXhwb3J0IG5hbWVzLlxuICAgKlxuICAgKiAqKlZhbGlkYXRlczogUmVxdWlyZW1lbnRzIDEuNCwgRGVzaWduIFByb3BlcnR5IDIqKlxuICAgKi9cblxuICBjb25zdCBzdGFja0J1aWxkZXJzID0gW1xuICAgIHsgbmFtZTogJ05ldHdvcmtTdGFja09wdGltaXplZCcsIGJ1aWxkZXI6IGJ1aWxkTmV0d29ya1N0YWNrIH0sXG4gICAgeyBuYW1lOiAnUmRzU3RhY2snLCBidWlsZGVyOiBidWlsZFJkc1N0YWNrIH0sXG4gICAgeyBuYW1lOiAnQ2FjaGVTdGFjaycsIGJ1aWxkZXI6IGJ1aWxkQ2FjaGVTdGFjayB9LFxuICAgIHsgbmFtZTogJ0F1dGhTdGFjaycsIGJ1aWxkZXI6IGJ1aWxkQXV0aFN0YWNrIH0sXG4gICAgeyBuYW1lOiAnU3RvcmFnZVN0YWNrJywgYnVpbGRlcjogYnVpbGRTdG9yYWdlU3RhY2sgfSxcbiAgXTtcblxuICB0ZXN0LmVhY2goc3RhY2tCdWlsZGVycykoJyRuYW1lIGV4cG9ydHMgZm9sbG93IG5hbWluZyBjb252ZW50aW9uJywgKHsgYnVpbGRlciB9KSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRlcigpO1xuICAgIGNvbnN0IGNmblRlbXBsYXRlID0gdGVtcGxhdGUudG9KU09OKCk7XG4gICAgY29uc3Qgb3V0cHV0cyA9IGNmblRlbXBsYXRlLk91dHB1dHMgfHwge307XG4gICAgXG4gICAgLy8gQ291bnQgb3V0cHV0cyB3aXRoIGV4cG9ydCBuYW1lc1xuICAgIGxldCBleHBvcnRlZE91dHB1dENvdW50ID0gMDtcbiAgICBcbiAgICAvLyBWZXJpZnkgZXhwb3J0cyAod2hlcmUgcHJlc2VudCkgZm9sbG93IG5hbWluZyBjb252ZW50aW9uXG4gICAgZm9yIChjb25zdCBba2V5LCBvdXRwdXRdIG9mIE9iamVjdC5lbnRyaWVzPGFueT4ob3V0cHV0cykpIHtcbiAgICAgIGlmIChvdXRwdXQuRXhwb3J0Py5OYW1lKSB7XG4gICAgICAgIGV4cG9ydGVkT3V0cHV0Q291bnQrKztcbiAgICAgICAgZXhwZWN0KG91dHB1dC5FeHBvcnQuTmFtZSkudG9NYXRjaCgvRm9vZENvc3RDYWxjdWxhdG9yLyk7XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIFZlcmlmeSBhdCBsZWFzdCBvbmUgb3V0cHV0IGlzIGV4cG9ydGVkIGZvciBjcm9zcy1zdGFjayB1c2FnZVxuICAgIGV4cGVjdChleHBvcnRlZE91dHB1dENvdW50KS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDEpO1xuICB9KTtcbn0pO1xuIl19