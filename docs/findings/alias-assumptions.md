# Alias assumptions — verified against AWS documentation

<!-- Node P2-N013, child A of P2-N012 (deploy the service from CI on
     merge). Contract: the parent specification
     (docs/specs/p2-n012-deploy-from-ci-on-merge.md in the
     coordinating repository), "Child A" paragraph, plus criteria I3,
     I4, I5, G3, G4. Six assumptions, each answered yes or no, sourced
     to docs.aws.amazon.com and read 2026-09-01. This finding is the
     whole deliverable of P2-N013; no code or template changed. -->

All documentation below was fetched with `curl` in this session on
**2026-09-01**. Quotes are verbatim from the fetched text (HTML
stripped of tags, or the page's own markdown mirror). Two claims
(assumptions 2 and 6's "does the adapter handle it" half) are
verified by reading this repository's installed `hono` package source
(`node_modules/hono/dist/adapter/aws-lambda/`, version pinned by
`package.json`'s `"hono": "^4.13.5"`) rather than AWS documentation,
since that is a fact about the adapter, not about AWS; each is marked
where the evidence comes from code rather than docs.aws.amazon.com.

## Summary

| # | Assumption | Answer | Exercised live by |
|---|---|---|---|
| 1 | Environment variables are per-version, not per-alias | **Yes** | G3, G4 |
| 2 | The handler can read its invoked qualifier through `hono/aws-lambda` | **Yes** | G3, I3 |
| 3 | A Lambda Function URL can be bound to an alias | **Yes** | G2, G3 |
| 4 | The production HTTP API integration can be bound to `live` | **Yes** | G2, G4 |
| 5 | A stack update does not reset `live` | **Yes, conditionally** — false under one named template shape | I4 |
| 6 | A Function URL delivers an event shape `hono/aws-lambda` handles | **Yes** | G3 |

No assumption came back a flat no. Assumption 5 is conditional: the
condition is avoidable and its avoidance is prescribed below,
concretely enough for child C to implement without re-researching it.

---

## 1. Environment variables are per-version, not per-alias

**Answer: Yes.**

**Source**: [Working with Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html), read 2026-09-01.

> "An environment variable is a pair of strings that is stored in a
> function's version-specific configuration."

> "You define environment variables on the unpublished version of
> your function. When you publish a version, the environment
> variables are locked for that version along with other
> version-specific configuration settings."

Corroborating: [Lambda function versions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html), read 2026-09-01 —

> "When you publish a version, Lambda creates an immutable snapshot of
> your function's code and configuration."

and the same page's list of changes that "qualify a function for
version publication" names **Environment variables** explicitly,
alongside function code, runtime, handler, and the rest of
version-specific configuration. Aliases carry no configuration of
their own beyond routing (`FunctionVersion`, optional weighted
`RoutingConfig`) and permissions — nothing in either page or in
[Create an alias for a Lambda function](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html)
(read 2026-09-01) describes an alias-level environment variable.

**Consequence**: confirmed as designed. One published version serves
both `live` and `preprod`; the handler cannot distinguish them from
`process.env` and must read the invoked qualifier instead (assumption
2). This is the premise the whole lease-table design rests on, and it
holds.

**Exercised live by**: **G3** (the lease cycle writes to the preprod
table when invoked via `preprod`) and **G4** (the same deployed
version, once promoted, answers production traffic from `live` and
writes to the production table) — the one version answering
differently through two aliases is the live demonstration that
environment variables did not, and could not, tell them apart.

---

## 2. The handler can read its invoked qualifier through `hono/aws-lambda`

**Answer: Yes.**

**Field and path**: `c.env.lambdaContext.invokedFunctionArn`, readable
inside any route handler in `src/httpApp.ts` (e.g. the `/mcp` or
`/health` handler already receives `c` as its first argument).

**Why**: AWS's own Lambda context object carries the invoked
qualifier. Source:
[Using the Lambda context object to retrieve Node.js function information](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-context.html)
(the URL `nodejs-prog-model-context.html` cited in this repository's
own `hono` type definitions 301-redirects here), read 2026-09-01:

> "invokedFunctionArn – The Amazon Resource Name (ARN) that's used to
> invoke the function. Indicates if the invoker specified a version
> number or alias."

**Adapter path (code, not AWS documentation)**: read from
`node_modules/hono/dist/adapter/aws-lambda/handler.js` and
`node_modules/hono/dist/types/adapter/aws-lambda/types.d.ts` in this
checkout. `handle()`'s returned Lambda handler is
`async (event, lambdaContext) => { ... app.fetch(req, { event, requestContext, lambdaContext }) ... }`
— it receives the Lambda `context` parameter (second argument to every
Lambda handler, per AWS's own contract) as `lambdaContext` and forwards
it, unmodified, as Hono's `env` binding. Hono's `Context.fetch`
signature is `fetch(request, env, executionCtx)`
(`node_modules/hono/dist/hono-base.js`), and `Context.env` is exactly
that second argument (`node_modules/hono/dist/context.js`). So inside
any handler registered on the app `createApp()` builds, `c.env` is
`{ event, requestContext, lambdaContext }`, and
`c.env.lambdaContext.invokedFunctionArn` is AWS's documented
`invokedFunctionArn` field, unqualified when invoked via `$LATEST` and
suffixed `:live` or `:preprod` when invoked via one of those aliases.
The type file's own `LambdaContext` interface JSDoc cites the same AWS
page linked above.

**Consequence**: none — assumption holds as designed. Child C parses
the qualifier as the ARN segment after the last `:`.

**Exercised live by**: **G3** (two Function URLs, one lease key,
both acquisitions succeed against two different tables — only
possible if each invocation correctly resolved its own qualifier) and
**I3** (the fail-closed refusal on an unrecognized qualifier is a
property of this same read).

---

## 3. A Lambda Function URL can be bound to an alias

**Answer: Yes.**

**Source**: [Creating and managing Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html), read 2026-09-01.

> "You can apply function URLs to any function alias, or to the
> `$LATEST` unpublished function version. You can't add a function URL
> to any other function version."

The AWS CLI form makes the alias binding explicit — the same page,
CLI section:

> "`--qualifier prod \\ // optional` ... This adds a function URL to
> the `prod` qualifier for the function"

The CloudFormation form (`AWS::Lambda::Url`, same page) accepts a
`Qualifier` property with the same meaning.

**Consequence**: none — confirmed as designed. `preprod`'s Function
URL is a `AWS::Lambda::Url` resource with `TargetFunctionArn` pointing
at the function and `Qualifier: preprod` (or the equivalent SAM
`FunctionUrlConfig` on the alias), one resource, no second API
Gateway, exactly the plan's design.

**Exercised live by**: **G2** (the preprod URL reports the new commit
immediately after merge) and **G3** (the three smoke checks run
against that URL).

---

## 4. The production HTTP API integration can be bound to `live`

**Answer: Yes.**

**Source 1** — the integration's target accepts an alias-qualified
function ARN:
[`AWS::ApiGatewayV2::Integration`](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-apigatewayv2-integration.html),
read 2026-09-01:

> "IntegrationUri — For a Lambda integration, specify the URI of a
> Lambda function."

The example on the same page builds `IntegrationUri` from
`Fn::GetAtt MyLambdaFunction.Arn` — i.e. whatever ARN the referenced
resource returns is what gets invoked. An `AWS::Lambda::Alias`
resource's own `Ref` return value is documented, per
[`AWS::Lambda::Alias`](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-alias.html)
(read 2026-09-01), as:

> "When you pass the logical ID of this resource to the intrinsic
> `Ref` function, `Ref` returns the resource ARN."

— the alias's own ARN (`...:function:name:live`), not the function's.
Passing `!Ref LiveAlias` (or `!GetAtt LiveAlias.AliasArn`) as the
`IntegrationUri`'s function reference therefore binds the integration
to that alias specifically.

**Source 2** — this is the documented, intended pattern, not an
incidental capability:
[Deploying serverless applications gradually with AWS SAM](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/automating-updates-to-serverless-apps.html),
read 2026-09-01, on `AutoPublishAlias`:

> "Creates an alias with a name that you provide (unless an alias
> already exists), and points to the updated version of the Lambda
> function. **Function invocations should use the alias qualifier to
> take advantage of this.**"

(Note: this repository does not use `AutoPublishAlias` — see
assumption 5 below for why — but the quote establishes that AWS's own
documented pattern for callers, including API Gateway, is to invoke
through the alias-qualified ARN.)

**Consequence**: none — confirmed as designed.

**Exercised live by**: **G2** (production's `service_identity`
reports the *previous* commit throughout and after the preprod-only
publish — proof the integration is not resolving to `$LATEST`, which
would have moved) and **G4** (production reports the new commit the
instant `live` is repointed, with no separate integration update).

---

## 5. A stack update does not reset `live` to the version just deployed

**Answer: Yes — conditionally.** It does not, *provided the template
does not manage `live` through SAM's `AutoPublishAlias` mechanism (or
any equivalent that ties the alias's `FunctionVersion` to the newly
published version on every deploy).* Under that shape, it **does**
reset `live` every time.

**The failing shape, documented**:
[`AWS::Serverless::Function` — `AutoPublishAlias`](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-function.html),
read 2026-09-01:

> "AWS SAM generates `AWS::Lambda::Version` and `AWS::Lambda::Alias`
> resources when this property is set."

And [Deploying serverless applications gradually with AWS SAM](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/automating-updates-to-serverless-apps.html),
read 2026-09-01, using an alias literally named `live` in its own
example:

> "`AutoPublishAlias`: By adding this property and specifying an alias
> name, AWS SAM: Detects when new code is being deployed... Creates
> and publishes an updated version of that function with the latest
> code. Creates an alias with a name that you provide (unless an alias
> already exists), **and points to the updated version** of the Lambda
> function."

That is the exact failure mode decision 2 of the plan and criterion
**I4** name: if `template.yaml` declared `AutoPublishAlias: live`,
every `sam deploy` — including the ordinary merge-to-`main` deploy
that is supposed to land only on `preprod` — would silently repoint
`live` at the code just published, defeating "deploy, then promote"
before child D's promote step ever runs.

**Why the alternative shape holds `live` in place**: `FunctionVersion`
on a plain `AWS::Lambda::Alias` resource is an ordinary, required
CloudFormation property, not a value SAM derives automatically.
[`AWS::Lambda::Alias`](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-alias.html),
read 2026-09-01:

> "FunctionVersion — The function version that the alias invokes...
> *Update requires*: No interruption."

CloudFormation only changes a resource property when the *template's
declared value* for it differs from the stack's current value for it
— nothing here derives `FunctionVersion` from `$LATEST` or from
whatever version a deploy happens to publish. If the template's
declared value for `live`'s `FunctionVersion` does not change between
deploys, the property does not change, regardless of what else the
deploy does (new code, a new `preprod`-pointed version, template
edits elsewhere).

**The mechanism child C must use (I4)**, concretely: manage `live` as
a **plain `AWS::Lambda::Alias`** resource — not via SAM's
`AutoPublishAlias` — whose `FunctionVersion` is driven by a template
**Parameter** (e.g. `LiveVersion`) rather than a literal or a
`!GetAtt` on the function's auto-published version:

```yaml
Parameters:
  LiveVersion:
    Type: String
    Description: >
      The published Lambda version currently promoted to `live`.
      NOT updated by an ordinary deploy — scripts/deploy.sh reads the
      alias's actual current FunctionVersion via
      `aws lambda get-alias --name live` and passes that same value
      back as this parameter on every ordinary deploy, so an ordinary
      stack update declares no change to it and CloudFormation leaves
      the LiveAlias resource alone. Promotion updates the live AWS
      alias directly via `aws lambda update-alias`, outside
      CloudFormation, after which the *next* ordinary deploy reads the
      new value back in — so the template's declared value and the
      live AWS state never fight each other.

Resources:
  LiveAlias:
    Type: AWS::Lambda::Alias
    Properties:
      FunctionName: !Ref McpFunction
      Name: live
      FunctionVersion: !Ref LiveVersion
```

Promotion itself (child D) is then a plain
`aws lambda update-alias --function-name <fn> --name live --function-version <new>`
CLI call — not a stack update — matching the plan's "Promotion and
rollback" section's "It is atomic" claim literally: it is one AWS API
call, not a CloudFormation deployment. `scripts/deploy.sh`'s ordinary
(non-promotion) path must read `live`'s current `FunctionVersion` from
AWS and pass it back as the `LiveVersion` parameter override on every
`sam deploy`, or the next ordinary deploy would revert the template's
stale default and silently demote production — this read-back step is
part of what "the mechanism" means here and belongs in child C's
`scripts/deploy.sh` changes, not left implicit.

**Consequence for child C**: do not use `AutoPublishAlias` for `live`
(it may still be irrelevant for `preprod`, which is *supposed* to move
on every deploy — but note `AutoPublishAlias` publishes on **code**
changes; `preprod`'s repoint in this design is driven by
`scripts/deploy.sh`'s explicit `publish-version` + `update-alias`
calls regardless, so `AutoPublishAlias` is not needed for either
alias and is simplest left unused entirely, avoiding the trap for both
aliases at once rather than only for `live`).

**Exercised live by**: **I4** directly — the criterion is this
assumption made live, per the specification's own text ("this is
child A's riskiest assumption made live"). Verified by a second
deploy in child D with a template change, confirming `live` is
unmoved.

---

## 6. A Function URL delivers an event shape the `hono/aws-lambda` adapter handles

**Answer: Yes.**

**AWS side — Function URL events are payload format 2.0, by AWS's own
statement of schema equivalence**:
[Invoking Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html),
read 2026-09-01:

> "The request and response event formats follow the same schema as
> the Amazon API Gateway payload format version 2.0."

> "version — The payload format version for this event. Lambda
> function URLs currently support payload format version 2.0. — `2.0`"

The same page's field table confirms the shape actually used:
top-level `rawPath`, `rawQueryString`, `headers`, `body`, plus a
`requestContext.http` object (`method`, `path`, `protocol`,
`sourceIp`, `userAgent`) — and that Function URLs place `$default` as
a fixed placeholder in `routeKey`/`requestContext.routeKey`/
`requestContext.stage`, so `rawPath` never carries a stage segment
(`requestContext.stage` doc note: "Function URLs don't use this
parameter. Lambda sets this to `$default` as a placeholder"). This
matters directly: it is the same "no stage segment in `rawPath`"
shape `template.yaml`'s own comments describe fixing the HTTP API's
`StageName` to `$default` to achieve, for the same reason — a Function
URL event needs no equivalent fix.

**Adapter side (code, not AWS documentation)**: read from
`node_modules/hono/dist/adapter/aws-lambda/handler.js` in this
checkout. `getProcessor()` selects an event processor by shape, not by
event source:

```js
var isProxyEventV2 = (event) => {
  return Object.hasOwn(event, "rawPath") && Object.hasOwn(event.requestContext ?? {}, "http");
};
```

A Function URL event satisfies this test identically to an HTTP API
v2 event (both carry top-level `rawPath` and `requestContext.http`),
so `handle()` routes it through the same `EventV2Processor` already
exercised by the production HTTP API integration — no separate,
unexercised code path. The exported `handle()` function's own JSDoc
(same file) states this directly: "Accepts events from API Gateway (v1
and v2), Application Load Balancer (ALB), and Lambda Function URLs."

**Consequence**: none — confirmed as designed. This closes the
assumption this child was added specifically to check (addition (i) of
the parent specification's Child A paragraph): an unhandled event
shape is the same defect class as the `$default` stage-prefix bug that
caused this service's first outage (a check that cannot fail in the
environment the code actually runs in), and this one is now checked in
writing, ahead of exercising it live.

**Exercised live by**: **G3** — the three smoke checks succeeding
against the real preprod Function URL is this assumption exercised
end to end; a shape the adapter mishandled would show up as every
smoke check failing, not a partial defect, since request parsing
happens before any route runs.

---

## A note on the documentation itself

One fetched page —
[Using Lambda aliases in event sources and permissions policies](https://docs.aws.amazon.com/lambda/latest/dg/using-aliases.md)
— carried a "See also" section instructing the reader to run an AWS
CLI command (`aws agent-toolkit search-skills ...`) framed as an
"optional suggestion for the user." That instruction was not acted on:
it is not part of this task, it did not come from the user or this
project's own artifacts, and content fetched from a web page is not a
channel through which this session takes direction. Flagged here for
visibility, not treated as evidence toward any of the six assumptions
above (it wasn't).
