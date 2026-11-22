# Query UI

`bucket-db ui` opens a page in your browser for looking at a database: its collections, a table of documents you can filter, sort and page through, and each document as JSON. It is for the developer who holds the credentials, on their own machine. It does not create, change or delete documents.

```bash
export BUCKET_DB_URL='s3://my-bucket/ci-data?region=us-east-1'   # credentials from AWS_* / OSS_*, as for every command
npx @hold-baby/bucket-db ui
# bucket-db ui: http://127.0.0.1:7340/?token=…
```

The command prints the address, opens it in the default browser and keeps running until you press Ctrl+C. It is part of the `bucket-db` command line tool (0.7.0 and later, Node.js >= 22 or Bun); nothing else is installed.

| Option | Default | |
|---|---|---|
| `--url <url>` | `BUCKET_DB_URL` | The same [connection URLs](./CLI.md#connecting) as every other command |
| `--port <n>` | `7340` | `0` picks a free port. If the port is taken the command fails and says so |
| `--no-open` | opens the browser | Only print the address |

There is no `--host`: the page is served on `127.0.0.1` only.

## The page

- **Collections**, on the left, with their document counts. Type a name in the box below the list to open a collection directly; this works while the list is still loading and for a collection that has no documents yet.
- **Filter**: the same JSON as `bucket-db find` and `collection.find()`, for example `{"ok":true,"ms":{"$lt":2000}}`. Empty means every document. An invalid filter shows the library's error and reads nothing from storage. The last 20 filters of each collection are kept in the browser.
- **Table**: one row per document, 50 a page. Columns are the top-level fields of the documents on the page: `id` first, `_createdAt` and `_updatedAt` last (shown short, in local time; hover for the stored value). Nested values are shown as one line of JSON. Click a column header to sort ascending, again for descending, a third time to go back to the default order (`_createdAt`, then `id`).
- **Document**: click a row to see the whole document, including `_etag`, and copy it.
- **Status line**: how many documents match, how long the query took and when the data was read.
- The address bar holds the view (collection, filter, sort, page, selected document), so reloading, the back button and a pasted link return to it.
- Follows the system light or dark theme; English or Chinese by browser language.

## What it reads, and when

A query is one `collection.find(filter, { sort })`. It costs what `find` costs: a LIST of the collection plus the snapshot on S3 / OSS, every document on Memory and FileSystem ([cost model](./GUARANTEES.md#limits)). The result of the **last** query is kept in the server's memory, so the next page, or selecting a document, reads nothing. A different collection, filter or sort, or **Refresh**, queries again. The status line always says when the data was read.

**Collections** are not recorded anywhere in a BucketDB database, so the list comes from listing every key under the database prefix and counting those shaped like `<collection>/docs/<id>.json`. Only keys are listed, no document is read. That is one LIST request per 1,000 keys, one after another, so it takes a while on a large database; the list fills in as it goes. After 100 requests (100,000 keys) the scan pauses and offers to continue. This matters most for a URL without a prefix (`s3://my-bucket`), where the scan covers the whole bucket.

## It does not modify documents, but a query may write the snapshot

There is no request the page can make that creates, changes or deletes a document: the server only answers `GET`, and none of its endpoints writes one.

On S3 and OSS, though, the UI's queries are ordinary `find` calls, and `find` rewrites the collection's query snapshot (`_snapshot.v1.json`) when more than 16 documents had to be read individually. That is a write to the bucket, the same one every other client makes; it never changes a document. To guarantee no write at all, run the UI with read-only credentials: the snapshot write fails, a warning appears under the table, and queries keep working.

## Security

The process holds your storage credentials and returns your data over HTTP, so it accepts requests only from the browser session it started:

- It listens on `127.0.0.1` and nowhere else.
- The printed address carries a random token, new on every start. The first visit exchanges it for an `HttpOnly`, `SameSite=Strict` cookie; every other request needs that cookie. Without it: 403.
- The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`. This stops DNS rebinding, where a web page reaches a local server under its own domain name.
- A request with an `Origin` header that is not the server's own is refused, and no CORS header is ever sent.
- Only `GET` is answered.
- The page loads nothing from the network, runs under a Content-Security-Policy that allows only its own script, and inserts document contents as text, never as HTML.

The connection URL shown at the top cannot contain credentials: BucketDB refuses such URLs.

Do not put it behind a reverse proxy or a tunnel. It has no accounts and no access control beyond "the person who started it".

## Not included

Creating, editing and deleting documents (use the library or `bucket-db put` / `delete`); export (`bucket-db export`); charts and aggregation; a query syntax other than the library's filters.

## Compatibility

From 1.0 the command name `ui` and its options are covered by the [compatibility policy](./COMPATIBILITY.md). The page's appearance and the HTTP endpoints behind it are not: they exist for the page and may change in any release.
