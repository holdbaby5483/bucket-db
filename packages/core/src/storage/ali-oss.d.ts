declare module 'ali-oss' {
  export default class OSS {
    constructor(options: {
      region: string;
      accessKeyId: string;
      accessKeySecret: string;
      bucket: string;
      endpoint?: string;
    });

    get(key: string): Promise<{
      content: Buffer;
      res: {
        headers: {
          etag?: string;
          'last-modified': string;
        };
      };
    }>;

    put(
      key: string,
      data: Buffer,
      options?: {
        headers?: Record<string, string>;
      }
    ): Promise<{
      res: {
        headers: {
          etag?: string;
        };
      };
    }>;

    delete(key: string): Promise<void>;

    head(key: string): Promise<void>;

    list(options?: { prefix?: string }): Promise<{
      objects?: Array<{ name: string }>;
    }>;
  }
}
