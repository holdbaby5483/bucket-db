# CI 中使用

在 CI 中，经常需要跨运行保存一些数据：测试耗时、不稳定测试记录、基准测试结果、部署记录等。BucketDB 可以把这些数据放进你已有的 bucket，配合 [命令行（CLI）](/guide/cli) 在任意 job 中读写，无需额外的数据库服务。凭证通过 OIDC 按 job 签发，CI 中不存放长期密钥。

完整示例文件见 GitHub 上的 [examples/ci](https://github.com/holdbaby5483/bucket-db/tree/main/examples/ci)。

## 文件一览

| 文件 | 说明 |
|---|---|
| [github-actions.yml](https://github.com/holdbaby5483/bucket-db/blob/main/examples/ci/github-actions.yml) | GitHub Actions：读取最近 10 次运行的 Jest 耗时、运行测试、记录本次耗时；注释中有 OSS 变体 |
| [gitlab-ci.yml](https://github.com/holdbaby5483/bucket-db/blob/main/examples/ci/gitlab-ci.yml) | GitLab CI 的同样流程，用 `aws sts assume-role-with-web-identity` 交换 job 的 OIDC token |
| [aws-iam-policy.json](https://github.com/holdbaby5483/bucket-db/blob/main/examples/ci/aws-iam-policy.json) | 角色的最小权限：只能在 `ci-data/` 下读、写、删对象和列举 |
| [github-oidc-trust-policy.json](https://github.com/holdbaby5483/bucket-db/blob/main/examples/ci/github-oidc-trust-policy.json) | 允许 `my-org/my-repo` 的 job 扮演该角色；尽量把 `sub` 收窄到分支或 environment |
| [aliyun-ram-policy.json](https://github.com/holdbaby5483/bucket-db/blob/main/examples/ci/aliyun-ram-policy.json) | OSS RAM 角色的同等最小权限 |
| [s3-lifecycle.json](https://github.com/holdbaby5483/bucket-db/blob/main/examples/ci/s3-lifecycle.json) | 数据保留：90 天后过期旧记录 |

本仓库在每次推送到 `main` 时运行同样的模式：[.github/workflows/dogfood.yml](https://github.com/holdbaby5483/bucket-db/blob/main/.github/workflows/dogfood.yml)，每个 job 用 CLI 记录基准结果，最后一个 job 检查所有结果都可读。

## 配置步骤

### 1. Bucket 与前缀

任何已有的 bucket 都可以。BucketDB 只访问 `BUCKET_DB_URL` 前缀下的 key（示例中为 `ci-data/`）：

```yaml
env:
  BUCKET_DB_URL: s3://my-ci-bucket/ci-data?region=us-east-1
```

### 2. 角色与最小权限

创建 IAM 角色，附加最小权限策略（`aws-iam-policy.json`）：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadWriteObjectsUnderThePrefix",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::my-ci-bucket/ci-data/*"
    },
    {
      "Sid": "ListOnlyThePrefix",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::my-ci-bucket",
      "Condition": { "StringLike": { "s3:prefix": "ci-data/*" } }
    }
  ]
}
```

GitHub Actions 的 OIDC 信任策略（`github-oidc-trust-policy.json`）：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        "StringLike": { "token.actions.githubusercontent.com:sub": "repo:my-org/my-repo:*" }
      }
    }
  ]
}
```

GitLab 使用 `gitlab.com` 作为 OIDC provider，audience 为 `sts.amazonaws.com`，条件 `gitlab.com:sub` 设为 `project_path:my-group/my-project:*`。

阿里云上为 OIDC 创建 RAM 角色，附加 `aliyun-ram-policy.json`：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:GetObject", "oss:PutObject", "oss:DeleteObject"],
      "Resource": "acs:oss:*:*:my-ci-bucket/ci-data/*"
    },
    {
      "Effect": "Allow",
      "Action": "oss:ListObjects",
      "Resource": "acs:oss:*:*:my-ci-bucket",
      "Condition": { "StringLike": { "oss:Prefix": "ci-data/*" } }
    }
  ]
}
```

### 3. 用 doctor 检查

在拥有该角色凭证的机器上运行：

```bash
BUCKET_DB_URL='s3://my-ci-bucket/ci-data?region=us-east-1' npx -y @hold-baby/bucket-db doctor
```

`doctor` 在 `ci-data/_doctor-<time>/` 下写入测试对象，检查存储服务提供的保证，然后删除自己写入的内容。详见 [CLI · doctor](/guide/cli#doctor)。

### 4. 数据保留（可选）

```bash
aws s3api put-bucket-lifecycle-configuration --bucket my-ci-bucket \
  --lifecycle-configuration file://s3-lifecycle.json
```

`s3-lifecycle.json` 让 `ci-data/test-durations/docs/` 下的记录 90 天后过期。OSS 上可在控制台或用 `ossutil` 为同一前缀添加生命周期规则。过期文档会从查询结果中消失（查询会列举文档）；它们在查询快照中的副本会在下次快照重写或执行 `bucket-db compact test-durations` 时清除。

## GitHub Actions

job 需要 `id-token: write` 权限。`aws-actions/configure-aws-credentials@v4` 导出 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`，BucketDB 直接读取，凭证随 job 结束失效：

```yaml
permissions:
  id-token: write
  contents: read

env:
  BUCKET_DB_URL: s3://my-ci-bucket/ci-data?region=us-east-1

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [1, 2, 3]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/ci-bucket-db
          aws-region: us-east-1

      - name: Show the slowest tests of the last 10 runs of this shard
        run: |
          npx -y @hold-baby/bucket-db find test-durations "{\"shard\":${{ matrix.shard }}}" --sort _createdAt:desc --limit 10 \
            | jq -r '[.[].tests[]] | group_by(.name) | map({name: .[0].name, avg: (map(.ms) | add / length)}) | sort_by(-.avg) | .[:5][] | "\(.avg | floor) ms  \(.name)"'

      - name: Run tests
        run: npx jest --shard=${{ matrix.shard }}/3 --json --outputFile=results.json

      # 以 run id 和分片为 key，重跑时覆盖而不是重复
      - name: Record durations
        if: always()
        run: |
          jq -c --arg sha "$GITHUB_SHA" --argjson shard ${{ matrix.shard }} \
            '{sha: $sha, shard: $shard, tests: [.testResults[].assertionResults[] | {name: .fullName, ms: .duration}]}' results.json \
            | npx -y @hold-baby/bucket-db put test-durations "$GITHUB_RUN_ID-${{ matrix.shard }}"
```

### 阿里云 OSS 变体

把凭证步骤换成 `aliyun/configure-aliyun-credentials-action@v1`，它导出 `ALIBABA_CLOUD_*` 变量，BucketDB 在没有 `OSS_*` 变量时会读取它们：

```yaml
env:
  BUCKET_DB_URL: oss://my-ci-bucket/ci-data?region=cn-hangzhou

# ...
      - uses: aliyun/configure-aliyun-credentials-action@v1
        with:
          role-to-assume: acs:ram::123456789012:role/ci-bucket-db
          oidc-provider-arn: acs:ram::123456789012:oidc-provider/github
```

## GitLab CI

用 job 的 OIDC token 交换临时凭证，CI/CD 变量中不存放密钥：

```yaml
variables:
  BUCKET_DB_URL: s3://my-ci-bucket/ci-data?region=us-east-1
  ROLE_ARN: arn:aws:iam::123456789012:role/ci-bucket-db

test:
  image: node:22
  id_tokens:
    AWS_ID_TOKEN:
      aud: sts.amazonaws.com
  before_script:
    - apt-get update -qq && apt-get install -y -qq awscli jq > /dev/null
    - >
      creds=$(aws sts assume-role-with-web-identity --role-arn "$ROLE_ARN"
      --role-session-name "gitlab-$CI_JOB_ID" --web-identity-token "$AWS_ID_TOKEN"
      --duration-seconds 3600 --query Credentials --output json)
    - export AWS_ACCESS_KEY_ID=$(echo "$creds" | jq -r .AccessKeyId)
    - export AWS_SECRET_ACCESS_KEY=$(echo "$creds" | jq -r .SecretAccessKey)
    - export AWS_SESSION_TOKEN=$(echo "$creds" | jq -r .SessionToken)
  script:
    - npx -y @hold-baby/bucket-db find test-durations --sort _createdAt:desc --limit 10 | jq -r '.[] | "\(.sha[0:8]) \(.totalMs) ms"'
    - npx jest --json --outputFile=results.json && status=0 || status=$?
    - >
      jq -c --arg sha "$CI_COMMIT_SHA" '{sha: $sha, totalMs: ([.testResults[].assertionResults[].duration] | add),
      tests: [.testResults[].assertionResults[] | {name: .fullName, ms: .duration}]}' results.json
      | npx -y @hold-baby/bucket-db put test-durations "$CI_PIPELINE_ID-$CI_JOB_ID"
    - exit $status
```

## 注意事项

- 用 `put` 并以运行派生的 key（如 `$GITHUB_RUN_ID-<shard>`）写入，而不是 `insert`：重跑会覆盖自己的记录，不会产生重复。
- 并行 job 可以写同一个集合；每次 `put` 都是一个独立对象。
- 只读 job（例如来自 fork 的 pull request）可以用只读凭证查询；此时 BucketDB 会跳过写入查询快照。
- 跨运行共享的数据请使用 bucket 后端。文件系统后端（`file://`）只在 runner 磁盘存在期间有效。
- 不要把凭证写进 `BUCKET_DB_URL`；BucketDB 会拒绝包含凭证的 URL，因此 URL 可以安全地打印在日志中。
