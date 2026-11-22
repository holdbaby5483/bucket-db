# Managing Credentials

How to handle the access credentials of BucketDB's cloud storage adapters (AWS S3, Alibaba Cloud OSS) safely.

## Security principles

### Never

**Hard-code credentials**
```typescript
// Dangerous: never do this
const s3Adapter = new S3Adapter({
  bucket: 'my-bucket',
  credentials: {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
  }
});
```

**Commit credentials to Git**
- Do not put `.env` files under version control
- Check that `.gitignore` lists the files holding secrets

**Print credentials in logs**
```typescript
// Dangerous
console.log('Using credentials:', credentials);
```

**Expose credentials in client-side code**
- Never use long-lived credentials in a browser
- Use temporary credentials or presigned URLs

---

## Recommended practices

### Where credentials come from

`S3Adapter` and `OSSAdapter` use a built-in client and depend on no SDK. The `credentials` option takes one of three forms:

| Form | Behaviour |
|---|---|
| omitted | Read from environment variables on the first request. S3: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`. OSS: `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_SESSION_TOKEN`; when those are unset, `ALIBABA_CLOUD_ACCESS_KEY_ID`, `ALIBABA_CLOUD_ACCESS_KEY_SECRET`, `ALIBABA_CLOUD_SECURITY_TOKEN`. Missing variables throw `ValidationError` |
| object `{ accessKeyId, secretAccessKey, sessionToken? }` | This fixed set is used |
| async function `() => Promise<Credentials>` | The result is cached; if it carries `expiresAt`, the function is called again 5 minutes before that time. A failed call is not cached; the next request calls it again |

```typescript
interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiresAt?: Date;
}
type CredentialProvider = () => Promise<Credentials>;
```

Region and endpoint have environment defaults too:

| Adapter | `region` | `endpoint` |
|---|---|---|
| `S3Adapter` | `AWS_REGION`, then `AWS_DEFAULT_REGION` | `AWS_ENDPOINT_URL_S3`, then `AWS_ENDPOINT_URL`, then `https://s3.<region>.amazonaws.com` |
| `OSSAdapter` | `OSS_REGION` | `https://s3.oss-<region>.aliyuncs.com`; no environment variable (`OSS_ENDPOINT` is not read) |

A missing region throws `ValidationError` when the adapter is constructed.

The built-in client does **not** read EC2 instance metadata, the ECS container credentials endpoint or `~/.aws/credentials`. To use an IAM role or RAM role in those environments, fetch temporary credentials in an async function and return `expiresAt` (sections 3 and 4 below). AWS Lambda puts the role's temporary credentials in `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`, so there you can omit `credentials`.

---

### 1. Environment variables

In local development or containers, use environment variables so no credential appears in code:

```typescript
import { S3Adapter, OSSAdapter } from '@hold-baby/bucket-db';

// Region, endpoint and credentials from AWS_* environment variables
const s3 = new S3Adapter({ bucket: process.env.S3_BUCKET! });

// Region and credentials from OSS_* (or ALIBABA_CLOUD_*) environment variables
const oss = new OSSAdapter({ bucket: process.env.OSS_BUCKET! });
```

**`.env` file** (do not commit it):
```bash
AWS_REGION=us-east-1
S3_BUCKET=my-bucket
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

OSS_REGION=cn-hangzhou
OSS_BUCKET=my-bucket
OSS_ACCESS_KEY_ID=your_access_key
OSS_ACCESS_KEY_SECRET=your_secret_key
```

These variable names match the AWS CLI and ossutil 2.0. The `ALIBABA_CLOUD_*` fallback names are the ones the Alibaba Cloud CLI and `aliyun/configure-aliyun-credentials-action` use, for example after OIDC in CI. `S3_BUCKET` and `OSS_BUCKET` are names this example chose; BucketDB does not read them.

**`.gitignore`**:
```
.env
.env.local
.env.*.local
```

**Loading the variables**:
```typescript
// Node.js 22+: node --env-file=.env app.js
// or use dotenv
import 'dotenv/config';

// Bun loads .env files automatically
```

---

### 2. A secrets manager

Keep credentials in a service such as AWS Secrets Manager or Alibaba Cloud KMS Secrets Manager and fetch them in an async function. `getSecret` below stands for your service's client call:

```typescript
import { S3Adapter } from '@hold-baby/bucket-db';
import { getSecret } from './secrets'; // your secrets manager client

const adapter = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: async () => {
    const secret = JSON.parse(await getSecret('bucket-db/s3-credentials'));
    return {
      accessKeyId: secret.accessKeyId,
      secretAccessKey: secret.secretAccessKey,
    };
  },
});
```

Without `expiresAt` the function is called only once; after rotating a long-lived key, restart the process, or return an `expiresAt` so the adapter reads the secret again periodically.

**Creating the secret (AWS)**:
```bash
aws secretsmanager create-secret \
  --name bucket-db/s3-credentials \
  --secret-string '{"accessKeyId":"AKI...","secretAccessKey":"wJa..."}'
```

---

### 3. Temporary credentials (STS)

Temporary credentials (AWS STS `AssumeRole`, Alibaba Cloud STS `AssumeRole`) come with a session token and an expiry time. Return `expiresAt` and the adapter fetches new ones 5 minutes before they expire:

```typescript
import { S3Adapter } from '@hold-baby/bucket-db';
import { assumeRole } from './sts'; // your code calling STS

const adapter = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: async () => {
    const { accessKeyId, secretAccessKey, sessionToken, expiration } = await assumeRole({
      roleArn: 'arn:aws:iam::123456789012:role/BucketDBRole',
      durationSeconds: 3600, // 1 hour
    });
    return { accessKeyId, secretAccessKey, sessionToken, expiresAt: new Date(expiration) };
  },
});
```

The same for OSS:

```typescript
import { OSSAdapter } from '@hold-baby/bucket-db';

const adapter = new OSSAdapter({
  bucket: 'my-bucket',
  region: 'cn-hangzhou',
  credentials: async () => {
    const sts = await assumeAliyunRole(); // your code calling Alibaba Cloud STS
    return {
      accessKeyId: sts.AccessKeyId,
      secretAccessKey: sts.AccessKeySecret,
      sessionToken: sts.SecurityToken,
      expiresAt: new Date(sts.Expiration),
    };
  },
});
```

If something outside your program has already put temporary credentials in the environment (`AWS_SESSION_TOKEN`, `OSS_SESSION_TOKEN` or `ALIBABA_CLOUD_SECURITY_TOKEN`), omit `credentials`. The environment is read only once, on the first request, and is not refreshed when the credentials expire; for long-running processes use an async function instead.

**Advantages**:
- Credentials expire on their own
- Permissions can be scoped narrowly
- Suits distributed systems

---

### 4. IAM / RAM roles on cloud hosts

On EC2 and Alibaba Cloud ECS, role credentials come from the instance metadata service; on AWS ECS tasks, from the container credentials endpoint (`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`). The built-in client does not call these endpoints by itself: read them in an async function and return `expiresAt`. For example, EC2 with IMDSv2:

```typescript
import { S3Adapter } from '@hold-baby/bucket-db';

const IMDS = 'http://169.254.169.254/latest';

async function ec2RoleCredentials() {
  const token = await fetch(`${IMDS}/api/token`, {
    method: 'PUT',
    headers: { 'x-aws-ec2-metadata-token-ttl-seconds': '21600' },
  }).then(r => r.text());
  const headers = { 'x-aws-ec2-metadata-token': token };
  const role = (await fetch(`${IMDS}/meta-data/iam/security-credentials/`, { headers }).then(r => r.text())).trim();
  const c = await fetch(`${IMDS}/meta-data/iam/security-credentials/${role}`, { headers }).then(r => r.json());
  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.Token,
    expiresAt: new Date(c.Expiration),
  };
}

const adapter = new S3Adapter({ bucket: 'my-bucket', region: 'us-east-1', credentials: ec2RoleCredentials });
```

**Advantages**:
- Credentials rotate automatically
- No keys to manage
- Permissions are managed centrally through IAM / RAM policies

---

## Rotating credentials

The credential function is the rotation mechanism: return `expiresAt` and the adapter calls the function again 5 minutes before it. You do not need your own cache.

```typescript
const adapter = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: async () => {
    const credentials = await getCredentialsFromSecretsManager(); // your code
    // read again every 24 hours
    return { ...credentials, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
  },
});
```

Do not log the credentials the function returns.

---

## Checklist

- [ ] Credentials live in environment variables or a secrets manager
- [ ] `.env` files are in `.gitignore`
- [ ] No keys are hard-coded
- [ ] Logs never contain credentials
- [ ] Deployments use IAM roles or a secrets manager
- [ ] Long-lived credentials are rotated regularly (at least every 90 days)
- [ ] Clients use temporary credentials or presigned URLs
- [ ] CI/CD uses encrypted secret variables or OIDC (see [examples/ci](../../examples/ci/))

---

## If credentials leak

1. **Revoke them immediately**
   ```bash
   # AWS
   aws iam delete-access-key --access-key-id AKIAIOSFODNN7EXAMPLE

   # Alibaba Cloud
   aliyun ram DeleteAccessKey --UserAccessKeyId LTAI...
   ```

2. **Create new credentials**
   - Create a new key in the console or CLI
   - Update every service that used the old one

3. **Check the logs**
   - Review CloudTrail (AWS) or ActionTrail (Alibaba Cloud)
   - Identify unauthorized access

4. **Tighten permissions**
   - Review IAM policies
   - Apply least privilege

---

## References

- [AWS IAM best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/)
- [Alibaba Cloud Resource Access Management](https://help.aliyun.com/product/28625.html)
- [Alibaba Cloud Key Management Service](https://help.aliyun.com/product/28933.html)

---

## Example project layout

```
my-project/
├── .env.example          # sample configuration (committed)
├── .env                  # real configuration (not committed)
├── .gitignore            # lists .env
├── src/
│   ├── config/
│   │   └── storage.ts    # credential loading
│   └── index.ts
└── README.md             # explains how to configure credentials
```

**`.env.example`**:
```bash
# AWS (S3Adapter reads AWS_*; the application reads S3_BUCKET)
AWS_REGION=us-east-1
S3_BUCKET=my-bucket
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here

# Alibaba Cloud (OSSAdapter reads OSS_*, else ALIBABA_CLOUD_*; the application reads OSS_BUCKET)
OSS_REGION=cn-hangzhou
OSS_BUCKET=my-bucket
OSS_ACCESS_KEY_ID=your_access_key_here
OSS_ACCESS_KEY_SECRET=your_secret_key_here
```

**`src/config/storage.ts`**:
```typescript
import { S3Adapter } from '@hold-baby/bucket-db';

export function createStorageAdapter() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('Missing required environment variable: S3_BUCKET');
  }

  // Region and credentials come from AWS_* environment variables:
  // a missing region throws ValidationError in the constructor, missing credentials on the first request
  return new S3Adapter({ bucket });
}
```
