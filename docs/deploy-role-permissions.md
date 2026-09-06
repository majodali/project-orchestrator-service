# Deploy role permissions (O7)

This is the IAM policy the owner applies to
`arn:aws:iam::<ACCOUNT_ID>:role/project-orchestrator-service-deploy` so
that `scripts/deploy.sh` (`sam build && sam deploy --resolve-s3
--capabilities CAPABILITY_IAM`) runs end to end, plus the promote and
smoke steps child D (node P2-N016) will add on top of it. It answers
**O7** from the
[p2-n012-deploy-from-ci-on-merge plan](https://github.com/majodali/project-orchestrator/blob/main/docs/plans/p2-n012-deploy-from-ci-on-merge.md)
and its
[specification](https://github.com/majodali/project-orchestrator/blob/main/docs/specs/p2-n012-deploy-from-ci-on-merge.md).
It does not write or change `scripts/deploy.sh` or `template.yaml`;
it is derived from reading both, resource by resource, on
2026-09-01, against `template.yaml` as it stands on this branch
(after node P2-N015).

## What this policy does not grant

Read this before applying it, so the blast radius is visible:

- **No data-plane access to either lease table.** `GetItem` /
  `PutItem` / `DeleteItem` on `LeaseTable` or `PreprodLeaseTable`
  belong solely to the Lambda function's own execution role
  (`template.yaml`'s `DynamoDBCrudPolicy` statements), which this
  deploy role creates but never assumes.
- **No ability to invoke the function or call its Function URL.**
  Deploying and promoting never requires `lambda:InvokeFunction` or
  `lambda:InvokeFunctionUrl` — the smoke test (child D) calls the
  preprod Function URL over plain HTTPS with the bearer token, not
  through the Lambda API.
- **No IAM reach outside one role-name prefix, and no ability to pass
  a role to anything but Lambda.** `iam:PassRole` carries a condition
  restricting it to `lambda.amazonaws.com`; the role-management
  actions are scoped to names beginning `project-orchestrator-service-`
  (see the naming caveat below). No `iam:CreateUser`,
  `iam:CreateAccessKey`, `iam:CreatePolicy` (managed policies), or
  attachment of any managed policy other than the one Lambda basic
  execution policy this stack's function needs.
- **No CloudFormation reach outside two named stacks** — the
  service's own stack and the SAM-managed artifact-bucket stack (see
  `--resolve-s3` below) — and no S3 reach outside that one managed
  bucket's name prefix.
- **No Secrets Manager reach outside the two secrets this stack's
  dynamic references resolve.** Not the App's installation token, not
  anything else in the account.
- **No EC2, VPC, networking, billing, or account-management actions**
  of any kind. Nothing here can create a user, alter this role's own
  policies, or touch a resource this stack does not own.

## Sources read this session (2026-09-01)

- AWS SAM developer guide, starting at
  <https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-permissions.html>
  and following its links, in particular:
  - `sam deploy` CLI reference —
    <https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-deploy.html>
    (`--resolve-s3`, `--capabilities`)
  - Introduction to `sam deploy` —
    <https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/using-sam-cli-deploy.html>
    (the managed-bucket naming convention, quoted below)
  - `sam pipeline bootstrap` —
    <https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-pipeline-bootstrap.html>
    (confirms the pipeline-execution-role / CloudFormation-execution-role
    split this project deliberately does not use — see below)
  - OIDC authentication with AWS SAM pipelines —
    <https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/deploying-with-oidc.html>
  - `sam delete` CLI reference (the "companion stack" pattern) —
    <https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-delete.html>
  - SAM CLI troubleshooting ("Failed to create managed resources") —
    <https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-troubleshooting.html>
- AWS Service Authorization Reference (linked from the CloudFormation
  mechanisms topic the permissions page leads to), for the exact
  resource type each action requires:
  - CloudFormation — <https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudformation.html>
  - Lambda — <https://docs.aws.amazon.com/service-authorization/latest/reference/list_lambda.html>
  - DynamoDB — <https://docs.aws.amazon.com/service-authorization/latest/reference/list_dynamodb.html>
  - IAM — <https://docs.aws.amazon.com/service-authorization/latest/reference/list_iam.html>
  - API Gateway Management V2 — <https://docs.aws.amazon.com/service-authorization/latest/reference/list_apigatewayv2.html>
- AWS CloudFormation User Guide, for how CloudFormation names a
  resource that carries no explicit name in the template:
  - `AWS::IAM::Role` (`RoleName`) — <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-iam-role.html>
  - `AWS::Lambda::Function` (`FunctionName`) — <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html>
  - `AWS::DynamoDB::Table` (`TableName`) — <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-dynamodb-table.html>
  - CloudFormation resource custom naming — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/cfn-reference-shared.html>
- GitHub, "Security hardening your deployments" — OIDC in AWS, for
  the trust-policy condition-key shape —
  <https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws>
- `template.yaml` and `scripts/deploy.sh` on this branch
  (`p2-n016-deploy-prerequisites`, based on `p2-n015-alias-aware-lease-table`),
  read resource by resource.

## The policy

Apply this as the deploy role's own permissions policy (not its trust
policy — see the separate section below). Replace `<ACCOUNT_ID>` and
`<REGION>` with real values; do not commit the filled-in version to
any git history (S-001).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormationServiceStack",
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
      "Resource": "arn:aws:cloudformation:<REGION>:<ACCOUNT_ID>:stack/project-orchestrator-service/*"
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
        "cloudformation:ExecuteChangeSet",
        "cloudformation:DeleteChangeSet"
      ],
      "Resource": "arn:aws:cloudformation:<REGION>:<ACCOUNT_ID>:stack/aws-sam-cli-managed-default/*"
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
      "Resource": "arn:aws:lambda:<REGION>:<ACCOUNT_ID>:function:project-orchestrator-service-*"
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
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/project-orchestrator-service-*"
    },
    {
      "Sid": "IamAttachOnlyTheLambdaBasicExecutionManagedPolicy",
      "Effect": "Allow",
      "Action": [
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:ListAttachedRolePolicies"
      ],
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/project-orchestrator-service-*",
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
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/project-orchestrator-service-*",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "lambda.amazonaws.com"
        }
      }
    },
    {
      "Sid": "DynamoDbLeaseTables",
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:DescribeTable",
        "dynamodb:UpdateTable",
        "dynamodb:DeleteTable",
        "dynamodb:UpdateTimeToLive",
        "dynamodb:DescribeTimeToLive",
        "dynamodb:TagResource",
        "dynamodb:UntagResource",
        "dynamodb:ListTagsOfResource"
      ],
      "Resource": "arn:aws:dynamodb:<REGION>:<ACCOUNT_ID>:table/project-orchestrator-service-*"
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
        "arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:project-orchestrator-service/mcp-auth-token-*",
        "arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:project-orchestrator-service/github-app-private-key-*"
      ]
    }
  ]
}
```

## Statement by statement, and what it derives from

### `CloudFormationServiceStack` — the stack `scripts/deploy.sh` deploys

Every `cloudformation:*` action `sam deploy` needs to create,
changeset-update, and describe `template.yaml`'s own stack
(`STACK_NAME`, default `project-orchestrator-service`). Each action's
required resource type, per the Service Authorization Reference, is
`stack*` (the asterisk means the SDK requires you to name it) —
`CreateStack`, `UpdateStack`, `DeleteStack`, `CreateChangeSet`,
`DescribeChangeSet`, `ExecuteChangeSet`, `DeleteChangeSet`,
`DescribeStackEvents`, `DescribeStackResource(s)`, `GetTemplate`,
`ListStackResources`, and `ListChangeSets` all require it; only
`DescribeStacks` and `GetTemplateSummary` list it as optional.
`DeleteStack` is included because CloudFormation performs an
automatic rollback-to-nothing on a first-ever `CreateStack` that
fails, using the calling principal's own credentials (`deploy.sh`
passes no `--role-arn`), which is a real `DeleteStack` call this role
must be able to make. `cloudformation:ValidateTemplate` is
deliberately absent: `sam validate --lint` runs `cfn-lint` locally and
makes no AWS API call (confirmed by
`.github/workflows/checks.yml`'s `sam-validate-lint` job on branch
`p2-n014-pr-checks`, which requests no OIDC token and configures no
AWS credentials at all), so nothing in this project's pipeline ever
calls the AWS-side `ValidateTemplate` action.

### `CloudFormationSamManagedArtifactStack` — confirming `--resolve-s3`

`--resolve-s3` is documented to "Automatically create an Amazon S3
bucket to use for packaging and deploying" (`sam deploy` CLI
reference). The walkthrough in "Intro to `sam deploy`" shows exactly
what it creates and how it is named:

> `Managed S3 bucket: aws-sam-cli-managed-default-samclisam-s3-demo-bucket-1a4x26zbcdkqr`
> `A different default S3 bucket can be set in samconfig.toml and auto resolution of buckets turned off by setting resolve_s3=False`

That bucket is not simply provisioned by a bare API call: the SAM CLI
troubleshooting page's own error text — `Error: Failed to create
managed resources: Unable to locate credentials` — names this step
"creat[ing] managed resources" and states it fails without AWS
credentials, i.e. it is a real, credentialed creation step, not a
passive lookup. `sam delete`'s reference page independently documents
the same "auto-provisioned alongside your stack, needs its own
deletion" shape for the ECR case, calling it a "companion stack" (its
own separate CloudFormation stack, checked and offered for deletion
separately from the main one). The naming convention
`aws-sam-cli-managed-default-<suffix>` for the bucket is consistent
with a CloudFormation-managed stack named `aws-sam-cli-managed-default`
whose stack output is that bucket name — the same
`<StackName>-<LogicalId>-<random>` pattern CloudFormation's own
"resource custom naming" page gives as its worked example (see the
naming caveat below). I could not find a page in the developer guide
that states in so many words "this is a second CloudFormation stack",
so this statement's existence rests on that chain of inference rather
than one sentence I can quote — flagged here rather than asserted as
directly quoted. The action list mirrors `CloudFormationServiceStack`
exactly because AWS does not publish the SAM CLI's internal call
sequence for this stack; granting parity is the honest choice over
guessing a narrower subset.

### `CloudFormationTemplateSummaryBeforeAnyStackExists` and `ApiGatewayV2AuthoringHasNoResourceLevelPermissions` — the two genuine `Resource: "*"` cases

- **`cloudformation:GetTemplateSummary`** — the Service Authorization
  Reference lists its resource type as `stack` **without** the
  asterisk that marks a required scope, and its own description reads
  "Grants permission to return information about a **new or
  existing** template" (emphasis mine) — it is the action SAM CLI
  uses to inspect a template file that may not yet correspond to any
  stack (the first-ever deploy). There is no stack ARN to scope to
  before the stack exists, so `Resource: "*"` is the documented,
  correct shape here, not a shortcut.
- **`apigateway:POST` / `GET` / `PATCH` / `DELETE`** — every
  `AWS::ApiGatewayV2::*` authoring operation (`CreateApi`, `GetApi`,
  `UpdateApi`, `DeleteApi`, `CreateIntegration`, `GetIntegration`,
  `UpdateIntegration`, `DeleteIntegration`, `CreateRoute`, `GetRoute`,
  `UpdateRoute`, `DeleteRoute`, plus the implicit `$default` stage
  SAM's `AWS::Serverless::HttpApi` creates) maps to one of these four
  IAM actions in the Service Authorization Reference's actions table.
  I checked that reference's own "Resource types defined by Amazon
  API Gateway Management V2" section directly: it is **empty** — this
  service defines no ARN-format resource type for these actions at
  all. There is nothing to scope to; `Resource: "*"` is the only
  legal shape the documentation supports for authoring an HTTP API,
  its integration, and its routes. (API Gateway does define a
  resource type for _invoking_ a deployed API,
  `execute-api:Invoke` — irrelevant here, since this role never
  invokes the API.)

### `SamManagedArtifactBucket`

Scoped to the two ARN forms (bucket and bucket contents) of the one
bucket name prefix `aws-sam-cli-managed-default-*` established above.
The action list is broader than "just upload the template and code" —
`PutBucketPolicy`, `PutEncryptionConfiguration`, and
`PutBucketPublicAccessBlock` are included because a bucket AWS
provisions for you on your behalf is a reasonable candidate for
security-hardening properties (SSL-only bucket policy, default
encryption, public-access block) that a "managed resources" step
would set, but I could not find the managed stack's own template
published anywhere in the developer guide to confirm which of these
it actually sets. This is the one statement in this policy where I
chose a defensibly-scoped-but-unverified action list over a documented
one, flagged honestly rather than presented as sourced.

### `LambdaFunctionAliasesAndFunctionUrls`

Every `lambda:*` action here has resource type `function*` (required)
in the Service Authorization Reference — this covers the function
itself, both aliases (`LiveAlias`, `PreprodAlias` — Lambda scopes
alias operations under the parent function's ARN, not a separate
alias ARN type), the Function URL, and the two
`AWS::Lambda::Permission` grants (`AddPermission` / `RemovePermission`,
whose resource-based-policy target is the function). This statement
is also where **O7's promote-and-smoke grant lives**: `PublishVersion`,
`UpdateAlias`, and `GetAlias` are already present for `sam deploy`'s
own needs (`deploy.sh`'s `LiveVersion` read-back calls `get-alias`
directly) and are exactly the three actions child D's promote step
needs — no separate statement was required.

### `IamExecutionRoleManagement`, `IamAttachOnlyTheLambdaBasicExecutionManagedPolicy`, `IamPassRoleToLambdaOnly` — `CAPABILITY_IAM`

`template.yaml` gives `McpFunction` no `Role:` property, so SAM
generates the function's execution role implicitly from its
`Policies:` list (two `DynamoDBCrudPolicy` grants) — this is exactly
what `--capabilities CAPABILITY_IAM` acknowledges, and it is why the
deploy role needs IAM permissions at all. Every `iam:*` action here
has resource type `role*` (required) in the Service Authorization
Reference. Two things are scoped beyond the bare role ARN:

- **`AttachRolePolicy` / `DetachRolePolicy`** carry an `ArnEquals`
  condition on `iam:PolicyARN`, restricting them to the one AWS
  managed policy this function's implicit role ever needs
  (`AWSLambdaBasicExecutionRole` — CloudWatch Logs only). This role
  cannot attach any other managed policy to anything, including
  itself.
- **`PassRole`** carries `iam:PassedToService: lambda.amazonaws.com`
  — this role can pass the execution role it creates to Lambda and to
  nothing else, regardless of what other role names might ever match
  the resource pattern below.

### The naming caveat that applies to `LambdaFunctionAliasesAndFunctionUrls`, the three IAM statements, and `DynamoDbLeaseTables`

`template.yaml` sets no `FunctionName`, no `RoleName` (there is no
explicit `AWS::IAM::Role` resource at all — SAM generates one), and
no `TableName` for either DynamoDB table. Each property's own
CloudFormation documentation says the same thing: _"If you don't
specify a name, CloudFormation generates \[a unique physical ID /
one]"_ — and does not commit to an exact format. CloudFormation's
"resource custom naming" page is the closest thing to a documented
format, and it is a worked example, not a guarantee: _"CloudFormation
might name an Amazon S3 bucket with the following physical ID
`MyStack-MyBucket-abcdefghijk1`"_ (emphasis on "might"). Given that
hedge, I scoped these four statements to the prefix
`project-orchestrator-service-*` — the stack name `deploy.sh` uses by
default (`STACK_NAME`) — rather than to `Resource: "*"`, because a
stack-name prefix is real, documented, and meaningfully narrower than
the account, but I am stating plainly that **this is my inference
from a "might," not a citation of a contract**, and it depends on
`STACK_NAME` keeping its default value. Two consequences follow: if
the owner ever runs `deploy.sh` with a non-default `STACK_NAME`, this
policy needs updating first; and the durable fix is to give
`McpFunction`, `LeaseTable`, and `PreprodLeaseTable` explicit names in
`template.yaml` (which would also let this policy scope to exact ARNs
instead of a prefix) — that is a `template.yaml` change, outside what
I may edit this session, so it is a Backlog item rather than something
I did.

### `DynamoDbLeaseTables`

Every action has resource type `table*` (required). Both
`LeaseTable` and `PreprodLeaseTable` fall under the same prefix
wildcard for the reason above.

### `SecretsForDeployTimeResolutionAndSmokeToken` — wider than O7's one-line summary, and why

The plan's O7 text names one grant: `secretsmanager:GetSecretValue`
"on that one secret" (the bearer token). Reading `template.yaml`
found two `{{resolve:secretsmanager:...}}` dynamic references, not
one — `MCP_AUTH_TOKEN` (from `AuthTokenSecretName`) **and**
`GITHUB_APP_PRIVATE_KEY` (from `GithubAppPrivateKeySecretName`).
`docs/runbook.md`'s own troubleshooting section already documents
that CloudFormation resolves a dynamic secret reference "using the
deploying principal's permissions, not the Lambda's execution role" —
so the deploy role needs `secretsmanager:GetSecretValue` on **both**
secrets for `sam deploy` itself to succeed, not just the one the
smoke test separately reads at promote time. I have included both;
this is a widening of O7's literal text grounded in `template.yaml`
and `docs/runbook.md`, not a new invention, and I am flagging it
rather than treating it as self-evidently already covered. Both
secret names are exact strings from `docs/runbook.md` Steps 1 and 2
(`project-orchestrator-service/mcp-auth-token`,
`project-orchestrator-service/github-app-private-key`); the trailing
`-*` accounts for the random suffix Secrets Manager appends to every
secret's ARN.

## `CAPABILITY_IAM`, summarized

`deploy.sh` passes `--capabilities CAPABILITY_IAM`, not
`CAPABILITY_NAMED_IAM` — correct, because `template.yaml` never sets
an explicit IAM resource name (see the naming caveat above);
`CAPABILITY_NAMED_IAM` is only required when a template names its own
IAM resources. Nothing in this policy needs to change if that stays
true; it would need `CAPABILITY_NAMED_IAM` (and this document's IAM
statements revisited) if a future change gave the execution role an
explicit `RoleName`.

## Does the OIDC trust policy need changing? (the I2 clause)

> **Corrected 2026-09-02 (node P2-N016, task T034, K-011).** This
> section originally reasoned that `majodali/project-orchestrator-service`
> predated GitHub's immutable-subject-claims cutoff (stated here, at
> the time, as 2026-08-27) and so needed only the plain `sub` form
> below. **That reasoning was wrong.** The repository was created
> **2026-08-26**, which is _after_ the cutoff, **2026-07-15**, not
> before it — this repository uses immutable subject claims
> **mandatorily**, not optionally, and the plain form was never a
> correct target for it. The JSON and the sourced reasoning below are
> now the immutable form; nothing else in this document changed. If
> the owner applied the original plain-form JSON at O7, the trust
> policy needs correcting to the form below, or every OIDC assumption
> will keep failing with the bare `sts:AssumeRoleWithWebIdentity`
> denial that names no failing condition —
> `.github/workflows/oidc-preflight.yml` (node P2-N016) exists to
> make that mismatch visible on demand, and
> `.github/workflows/deploy.yml`'s own first step does the same
> automatically on a broken merge.

**This session cannot read the deploy role's actual trust policy** —
no dispatched session holds AWS credentials (see K-011 in the
specification's _How verification runs_ section), which is why I2
marks this clause owner-attested. What follows is the target shape,
for the owner to compare the live policy against and correct if it
differs, per plan decision 3 and specification criterion I2: the
subject must be restricted to this repository's `main` ref, not to
the repository alone and not to any ref.

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
          "token.actions.githubusercontent.com:sub": "repo:majodali@576567/project-orchestrator-service@1347863895:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

Source: GitHub's "Security hardening your deployments — OIDC in AWS"
guide (<https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws>,
read again 2026-09-02), which gives the `Condition` shape (`aud` +
`token.actions.githubusercontent.com:sub`) and states plainly that IAM
"recommends that users evaluate the [`sub`] condition key... to limit
which GitHub actions are able to assume the role." That page documents
two subject-claim syntaxes and states which repositories use which:
the mutable form, `repo:OWNER/REPO:ref:refs/heads/BRANCH`, for
repositories that predate GitHub's immutable-subject-claims cutoff and
have not opted in; and the **immutable** form, literally
`repo:OWNER@OWNER-ID/REPO@REPO-ID:ref:refs/heads/BRANCH`, for
repositories created after **July 15, 2026** or that have opted in.
`majodali/project-orchestrator-service` was created **2026-08-26** —
after that cutoff — so it uses the immutable form **mandatorily**, not
by opt-in, which is what the JSON above now carries. Owner ID `576567`
and repository ID `1347863895` are confirmed from the GitHub API and
are public identifiers, not secrets (S-001 governs secret _values_,
not these) — written literally here rather than as a placeholder,
because a placeholder would defeat the point of a document the owner
pastes from directly.

If the role's current trust policy already matches the JSON above, no
change is needed and O7's trust-policy clause is simply confirmed as
already correct. If it trusts the old mutable-form subject, any
broader subject (any ref, any repository), or carries no `sub`
condition at all, it needs changing to the JSON above before child D
can rely on I2.
