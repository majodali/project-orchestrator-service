# Preview deploy role permissions (O-prev-4)

The IAM policy for `project-orchestrator-service-preview-deploy`
(D149's option A, node P2-N073, child B of P2-N063). It is derived from
[`docs/deploy-role-permissions.md`](deploy-role-permissions.md) — same
repository, same `scripts/deploy.sh`, same `template.yaml` — narrowed to
the preview stack's own resource names and to exactly the three preview
secrets, with no grant on anything production's role reaches. Read that
document first for the statement-by-statement sourcing (the AWS Service
Authorization Reference citations, the `CloudFormationSamTransform` and
function-URL findings, and the two genuine `Resource: "*"` cases); this
document only states what differs and why.

## What this policy does not grant, beyond what the production document already lists

- **No reach into the production stack, `stack/project-orchestrator-service/*`, or anything named `project-orchestrator-service-<non-preview>`.** Every scoped statement below carries the `-preview-` or `-preview` resource segment; there is no statement here with the bare `project-orchestrator-service-*` prefix the production policy uses.
- **No DynamoDB statement at all.** The production policy's `DynamoDbLeaseTables` statement is a K-011 remnant for the two lease tables `template.yaml` no longer declares; the preview stack was never created with them, so this role needs no DynamoDB action, now or for that migration.
- **The three preview secrets only**, under the exact names D151's amendment fixed: `project-orchestrator-service-preview/mcp-auth-token`, `project-orchestrator-service-preview/github-app-private-key`, `project-orchestrator-service-preview/view-token`. Never the three production secret names.

## The policy

Apply this as `project-orchestrator-service-preview-deploy`'s own
permissions policy. Replace `<ACCOUNT_ID>` and `<REGION>`; never commit
the filled-in version (S-001).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormationPreviewStack",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStackResource",
        "cloudformation:DescribeStackResources",
        "cloudformation:GetTemplate",
        "cloudformation:ListStackResources",
        "cloudformation:ListChangeSets",
        "cloudformation:CreateChangeSet",
        "cloudformation:DescribeChangeSet",
        "cloudformation:ExecuteChangeSet",
        "cloudformation:DeleteChangeSet"
      ],
      "Resource": "arn:aws:cloudformation:<REGION>:<ACCOUNT_ID>:stack/project-orchestrator-service-preview/*"
    },
    {
      "Sid": "CloudFormationSamManagedArtifactStack",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStackResource",
        "cloudformation:DescribeStackResources",
        "cloudformation:GetTemplate",
        "cloudformation:ListStackResources",
        "cloudformation:ListChangeSets",
        "cloudformation:CreateChangeSet",
        "cloudformation:DescribeChangeSet",
        "cloudformation:DeleteChangeSet"
      ],
      "Resource": "arn:aws:cloudformation:<REGION>:<ACCOUNT_ID>:stack/aws-sam-cli-managed-default/*"
    },
    {
      "Sid": "CloudFormationSamTransform",
      "Effect": "Allow",
      "Action": "cloudformation:CreateChangeSet",
      "Resource": "arn:aws:cloudformation:*:aws:transform/Serverless-2016-10-31"
    },
    {
      "Sid": "CloudFormationTemplateSummaryBeforeAnyStackExists",
      "Effect": "Allow",
      "Action": "cloudformation:GetTemplateSummary",
      "Resource": "*"
    },
    {
      "Sid": "SamManagedArtifactBucket",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketPolicy",
        "s3:PutBucketPolicy",
        "s3:GetEncryptionConfiguration",
        "s3:PutEncryptionConfiguration",
        "s3:GetBucketPublicAccessBlock",
        "s3:PutBucketPublicAccessBlock",
        "s3:GetBucketVersioning",
        "s3:PutBucketVersioning",
        "s3:GetBucketTagging",
        "s3:PutBucketTagging",
        "s3:ListBucket",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::aws-sam-cli-managed-default-*",
        "arn:aws:s3:::aws-sam-cli-managed-default-*/*"
      ]
    },
    {
      "Sid": "LambdaFunctionAliasesAndFunctionUrls",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:DeleteFunction",
        "lambda:TagResource",
        "lambda:UntagResource",
        "lambda:ListTags",
        "lambda:GetPolicy",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:CreateAlias",
        "lambda:GetAlias",
        "lambda:UpdateAlias",
        "lambda:DeleteAlias",
        "lambda:ListAliases",
        "lambda:PublishVersion",
        "lambda:ListVersionsByFunction",
        "lambda:CreateFunctionUrlConfig",
        "lambda:GetFunctionUrlConfig",
        "lambda:UpdateFunctionUrlConfig",
        "lambda:DeleteFunctionUrlConfig"
      ],
      "Resource": "arn:aws:lambda:<REGION>:<ACCOUNT_ID>:function:project-orchestrator-service-preview-*"
    },
    {
      "Sid": "IamExecutionRoleManagement",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:GetRole",
        "iam:DeleteRole",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRolePolicy",
        "iam:ListRolePolicies",
        "iam:TagRole",
        "iam:UntagRole"
      ],
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/project-orchestrator-service-preview-*"
    },
    {
      "Sid": "IamAttachOnlyTheLambdaBasicExecutionManagedPolicy",
      "Effect": "Allow",
      "Action": [
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:ListAttachedRolePolicies"
      ],
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/project-orchestrator-service-preview-*",
      "Condition": {
        "ArnEquals": {
          "iam:PolicyARN": "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
        }
      }
    },
    {
      "Sid": "IamPassRoleToLambdaOnly",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/project-orchestrator-service-preview-*",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "lambda.amazonaws.com"
        }
      }
    },
    {
      "Sid": "ApiGatewayV2AuthoringHasNoResourceLevelPermissions",
      "Effect": "Allow",
      "Action": [
        "apigateway:POST",
        "apigateway:GET",
        "apigateway:PATCH",
        "apigateway:DELETE"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SecretsForDeployTimeResolutionAndSmokeToken",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": [
        "arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:project-orchestrator-service-preview/mcp-auth-token-*",
        "arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:project-orchestrator-service-preview/github-app-private-key-*",
        "arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:project-orchestrator-service-preview/view-token-*"
      ]
    }
  ]
}
```

`CloudFormationSamManagedArtifactStack`, `ApiGatewayV2AuthoringHasNoResourceLevelPermissions` and the two
`Resource: "*"` statements are identical to the production policy's —
the managed artifact bucket's own stack and HTTP API authoring have no
narrower, resource-level form to scope to (see the production
document's own entries for these `Sid`s for the citations); sharing
the one managed bucket across both stacks is the same `--resolve-s3`
default both deploys use, not a widening introduced here.

## The naming caveat (carried from the production document)

As the production document's own "naming caveat" section says: nothing
in `template.yaml` gives `McpFunction` or its implicit execution role an
explicit name, so each name above rests on `STACK_NAME` keeping the
value `scripts/deploy.sh` and this workflow default it to
(`project-orchestrator-service-preview`) — CloudFormation's own
documentation only ever commits to "a unique physical ID," not an exact
format. If `STACK_NAME` ever changes for the preview stack, this policy
needs updating first, the same dependency the production document
states for its own prefix.

## The trust policy (D157)

`sts:AssumeRoleWithWebIdentity`, trusted for the preview job's own
Environment subject — not the `ref:refs/heads/main` form the production
role trusts, so a pull request's own `scripts/deploy.sh` cannot use this
token to reach the production role (D151, D157):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:majodali@576567/project-orchestrator-service@1347863895:environment:preview"
        }
      }
    }
  ]
}
```

Source: the same GitHub "Security hardening your deployments — OIDC in
AWS" guide the production document cites, which documents the
Environment form of the subject claim
(`repo:OWNER@OWNER-ID/REPO@REPO-ID:environment:NAME`) alongside the
`ref:` form; `.github/workflows/preview.yml`'s own preflight step prints
the claim's actual `sub` on every run, which is how D157's option A
("Child B proves it from the claim the run's own preflight prints") is
checked against this text.
