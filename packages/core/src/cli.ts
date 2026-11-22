#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { BucketDB } from './bucket-db.js';
import { BucketDBError, ValidationError } from './errors.js';
import { docsPrefix, validateName } from './keys.js';
import { doctor } from './doctor.js';
import { runUi } from './ui/server.js';
import { openUrl } from './url.js';

const USAGE = `Usage: bucket-db <command> [arguments] [--url <url>]

  get <collection> <id>            print a document (exit 2 if it does not exist)
  put <collection> <id> [json]     create or replace a document; JSON from the argument or stdin
  find <collection> [filter]       print matching documents as a JSON array
       [--sort field[:desc]]... [--limit n] [--offset n]
  count <collection> [filter]      print the number of (matching) documents
  delete <collection> <id>         delete a document (no error if it does not exist)
  export <collection>              print every document as JSON Lines
  import <collection> [file]       write JSON Lines from a file or stdin; documents keep id and timestamps
  compact <collection>             rebuild the query snapshot
  doctor                           check what the storage service guarantees
  ui [--port n] [--no-open]        browse the database in a local web page (default port 7340)

The URL comes from --url or BUCKET_DB_URL: s3://bucket/prefix?region=…,
oss://bucket/prefix?region=…, file:///dir. Credentials come from the
environment (AWS_* / OSS_*), never the URL.
Exit codes: 0 success, 1 error, 2 not found.`;

const encoder = new TextEncoder();
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError(`${what} is not valid JSON`);
  }
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ValidationError(`${what} must be a JSON object`);
  return value as Record<string, unknown>;
}

function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new ValidationError(`Missing <${name}>\n\n${USAGE}`);
  return value;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      sort: { type: 'string', multiple: true },
      limit: { type: 'string' },
      offset: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      port: { type: 'string' },
      'no-open': { type: 'boolean' },
    },
  });
  const [command, name, ...args] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }

  const { adapter, dbPath } = openUrl(values.url);
  if (command === 'doctor') return (await doctor(adapter, dbPath, line => console.log(line))) > 0 ? 1 : 0;
  if (command === 'ui') {
    const label = values.url ?? process.env.BUCKET_DB_URL ?? '';
    return runUi(adapter, dbPath, { label, port: values.port, open: !values['no-open'] });
  }

  const db = new BucketDB(adapter, dbPath, { logger: ({ message }) => console.error(`bucket-db: ${message}`) });
  const collection = db.collection<Record<string, unknown> & { id: string }>(required(name, 'collection'));
  const filter = () => (args[0] === undefined ? {} : object(parseJson(args[0], 'filter'), 'filter'));
  const stdinOr = (value: string | undefined) => value ?? readFileSync(0, 'utf8');

  switch (command) {
    case 'get': {
      const document = await collection.findById(required(args[0], 'id'));
      if (!document) {
        console.error(`bucket-db: not found: ${args[0]}`);
        return 2;
      }
      print(document);
      return 0;
    }
    case 'put':
      print(await collection.put(required(args[0], 'id'), object(parseJson(stdinOr(args[1]), 'document'), 'document')));
      return 0;
    case 'find': {
      const sort = Object.fromEntries(
        (values.sort ?? []).map(spec => {
          const [field, direction = 'asc'] = spec.split(':');
          if (direction !== 'asc' && direction !== 'desc')
            throw new ValidationError(`--sort ${spec}: use field, field:asc or field:desc`);
          return [field, direction === 'asc' ? 1 : -1] as const;
        })
      );
      const number = (text: string | undefined) => (text === undefined ? undefined : Number(text));
      print(await collection.find(filter(), { sort, limit: number(values.limit), offset: number(values.offset) }));
      return 0;
    }
    case 'count':
      print(await collection.count(filter()));
      return 0;
    case 'delete':
      await collection.delete(required(args[0], 'id'));
      return 0;
    case 'export':
      for (const { _etag, ...document } of await collection.find({}))
        process.stdout.write(`${JSON.stringify(document)}\n`);
      return 0;
    case 'import': {
      // Written in the storage format directly so a restored backup keeps ids and timestamps.
      const prefix = docsPrefix(dbPath, validateName('collection name', name));
      const lines = stdinOr(args[0] === undefined ? undefined : readFileSync(args[0], 'utf8'))
        .split('\n')
        .filter(line => line.trim());
      const documents = lines.map((line, index) => object(parseJson(line, `line ${index + 1}`), `line ${index + 1}`));
      for (let start = 0; start < documents.length; start += 16) {
        await Promise.all(
          documents.slice(start, start + 16).map(({ _etag, ...document }) => {
            if (typeof document.id !== 'string') return collection.insert(document);
            const { id, ...body } = document;
            return adapter.put(
              `${prefix}${validateName('document ID', id)}.json`,
              encoder.encode(JSON.stringify({ id, ...body }))
            );
          })
        );
      }
      print(documents.length);
      return 0;
    }
    case 'compact':
      await collection.compact();
      return 0;
    default:
      throw new ValidationError(`Unknown command: ${command}\n\n${USAGE}`);
  }
}

main().then(
  code => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(
      `bucket-db: ${error instanceof BucketDBError || error instanceof TypeError ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
);
