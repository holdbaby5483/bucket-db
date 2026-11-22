# Compatibility policy

From 1.0.0, `@hold-baby/bucket-db` follows [Semantic Versioning](https://semver.org/): a change that can break code, scripts or data written against an earlier 1.x release only ships in a new major version. Before 1.0, minor versions could break (0.4, 0.5 and 0.6 did, each with a migration guide).

## What is covered

A breaking change to any of these needs a major version:

- **Exports of the package entry point** (`@hold-baby/bucket-db`): classes, functions, types and their signatures. Types count: if code that compiled stops compiling, it is breaking. `packages/core/tests/types/public-api.ts` pins the important ones.
- **Error classes** and the four `StorageError.kind` values (`not-found`, `conflict`, `transient`, `permanent`).
- **The storage adapter contract**: `get`, `put`, `delete`, `list`, `capabilities`, `remote`. Custom backends implement it.
- **The storage format** ([STORAGE-FORMAT.md](STORAGE-FORMAT.md)): `<dbPath>/<collection>/docs/<id>.json` and the document body rules. Minor and patch releases never change it; data written by any 1.x release stays readable by every later 1.x release.
- **The CLI**: command names, arguments, flags, the output format (one JSON value per line, JSON Lines for `export`) and the exit codes (0 success, 1 error, 2 not found).
- **Connection URLs**: schemes, query parameters, and the rule that a URL must not contain credentials.
- **The guarantees** in [GUARANTEES.md](GUARANTEES.md): weakening one is breaking.

## What is not covered

- Anything imported from inside the package (`@hold-baby/bucket-db/dist/...`).
- The text of error and log messages. Match on error classes and `kind`, not on messages.
- Request counts, latency and other numbers in [BENCHMARKS.md](BENCHMARKS.md); they may improve or change with the service.
- The query snapshot's contents. It is disposable: a format change uses a new versioned key (`_snapshot.v2.json`), clients of different versions keep separate snapshots, and no migration is ever needed.
- Behaviour that is documented as unverified or not tested.

## Additions in minor releases

Minor releases may add exports, optional parameters and options, CLI commands and flags, URL parameters, optional members of the adapter contract, and new `LogEvent`s. Code written for an earlier 1.x release keeps working. A custom adapter keeps working when an optional contract member is added.

## Runtimes

Supported runtimes are the Node.js release lines that are in active or maintenance LTS, and current Bun. Dropping a Node line after it reaches end of life happens in a minor release and is announced in the changelog; dropping a line that is still supported upstream needs a major release.

## Deprecation

Before removing something in a major release, it is marked deprecated in a minor release: in the changelog, in the docs, and in its type declaration (`@deprecated`). Deprecated features keep working until the next major release.
