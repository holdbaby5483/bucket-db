import { ValidationError } from '../../errors.js';

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** When a provider returns this, the provider is called again 5 minutes before it. */
  expiresAt?: Date;
}

export type CredentialProvider = () => Promise<Credentials>;

/** Environment variable names for the access key id, secret and session token. */
export type CredentialEnv = [accessKeyId: string, secretAccessKey: string, sessionToken: string];

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Turns the `credentials` option into a function returning current
 * credentials. Without the option, credentials come from the first variable
 * set in `envSets` that has both an id and a secret, read on first use;
 * none set throws ValidationError then.
 */
export function resolveCredentials(
  option: Credentials | CredentialProvider | undefined,
  envSets: CredentialEnv[]
): CredentialProvider {
  if (typeof option === 'object') return () => Promise.resolve(option);

  const provider: CredentialProvider =
    option ??
    (async () => {
      for (const [idVar, secretVar, tokenVar] of envSets) {
        const accessKeyId = process.env[idVar];
        const secretAccessKey = process.env[secretVar];
        if (accessKeyId && secretAccessKey) {
          return { accessKeyId, secretAccessKey, sessionToken: process.env[tokenVar] || undefined };
        }
      }
      const names = envSets.map(([idVar, secretVar]) => `${idVar} and ${secretVar}`).join(', or ');
      throw new ValidationError(`No credentials: pass the credentials option or set ${names}`);
    });

  let cached: Promise<Credentials> | undefined;
  let refreshAt = Infinity;
  return () => {
    if (!cached || Date.now() >= refreshAt) {
      const pending = provider().then(credentials => {
        refreshAt = credentials.expiresAt ? credentials.expiresAt.getTime() - REFRESH_MARGIN_MS : Infinity;
        return credentials;
      });
      // A failed call is not cached; the next request calls the provider again.
      pending.catch(() => {
        if (cached === pending) cached = undefined;
      });
      cached = pending;
      refreshAt = Infinity;
    }
    return cached;
  };
}
