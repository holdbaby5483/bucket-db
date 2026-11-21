# CI recipes

Keeping data across CI runs (test durations, flaky-test records, benchmark results, deploy records) in a bucket you already have, with credentials issued per job through OIDC.

| File | What it is |
|---|---|
| [`github-actions.yml`](github-actions.yml) | GitHub Actions: read the last 10 runs' Jest durations, run the tests, record this run's durations. OSS variant in the comments. |
| [`gitlab-ci.yml`](gitlab-ci.yml) | The same for GitLab CI, exchanging the job's OIDC token with `aws sts assume-role-with-web-identity`. |
| [`aws-iam-policy.json`](aws-iam-policy.json) | Least privilege for the role: read, write and delete objects and list, only under `ci-data/`. |
| [`github-oidc-trust-policy.json`](github-oidc-trust-policy.json) | Lets jobs of `my-org/my-repo` assume the role. Narrow `sub` to a branch or environment if you can. |
| [`aliyun-ram-policy.json`](aliyun-ram-policy.json) | The same least privilege for an OSS RAM role. |
| [`s3-lifecycle.json`](s3-lifecycle.json) | Data retention: expire records older than 90 days. |

This repository runs the same pattern on every push to `main` in [`.github/workflows/dogfood.yml`](../../.github/workflows/dogfood.yml): each job records its benchmark results with the CLI and a final job checks that all of them are readable.

## Setup

1. **Bucket and prefix.** Any existing bucket works; BucketDB only touches keys under the prefix in `BUCKET_DB_URL` (`ci-data/` here).
2. **Role.** Create an IAM role with `aws-iam-policy.json` and a trust policy for your CI's OIDC provider: `github-oidc-trust-policy.json` for GitHub; for GitLab use `gitlab.com` as the provider, audience `sts.amazonaws.com`, and condition `gitlab.com:sub` on `project_path:my-group/my-project:*`. On Alibaba Cloud create a RAM role for OIDC with `aliyun-ram-policy.json`.
3. **Check it.** From a machine with the role's credentials:

   ```bash
   BUCKET_DB_URL='s3://my-ci-bucket/ci-data?region=us-east-1' npx -y @hold-baby/bucket-db doctor
   ```

   `doctor` writes under `ci-data/_doctor-<time>/`, checks what the service guarantees, and removes what it wrote.
4. **Retention (optional).** `aws s3api put-bucket-lifecycle-configuration --bucket my-ci-bucket --lifecycle-configuration file://s3-lifecycle.json`. On OSS, add a lifecycle rule for the same prefix in the console or with `ossutil`. Expired documents disappear from queries because queries list the documents; their copies in the query snapshot go away at its next rewrite or `bucket-db compact test-durations`.

## Notes

- Use `put` with a key derived from the run (`$GITHUB_RUN_ID-<shard>`), not `insert`: a re-run overwrites its own record instead of adding a duplicate.
- Parallel jobs can write to the same collection; every `put` is one independent object.
- Read-only jobs (pull requests from forks, for example) can query with read-only credentials; BucketDB then skips writing its query snapshot.
- Use a bucket backend for data shared between runs. The filesystem backend (`file://`) only lives as long as the runner's disk.
- No credentials go in `BUCKET_DB_URL`; BucketDB refuses URLs that contain them, so the URL can be printed in logs.
