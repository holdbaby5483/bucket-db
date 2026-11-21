/**
 * Every document carries these fields. `id` comes from the object key and
 * `_etag` from the storage service; neither is stored in the document body.
 */
export interface Document {
  id: string;
  _etag?: string;
  _createdAt?: string;
  _updatedAt?: string;
}

type SystemField = 'id' | '_etag' | '_createdAt' | '_updatedAt';

/** Fields accepted by `insert`: everything except system fields. */
export type InsertDocument<T extends Document> = Omit<T, SystemField>;

/** Fields accepted by `update`: a partial document without system fields. */
export type UpdateDocument<T extends Document> = Partial<Omit<T, SystemField>>;

export type QueryOperator = '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte' | '$in' | '$nin';

export type QueryValue<T> =
  | T
  | {
      $eq?: T;
      $ne?: T;
      $gt?: T;
      $gte?: T;
      $lt?: T;
      $lte?: T;
      $in?: T[];
      $nin?: T[];
    };

export type QueryFilter<T> = {
  [K in keyof T]?: QueryValue<T[K]>;
};

export interface QueryOptions {
  /** 0 returns no documents. Default: all. */
  limit?: number;
  offset?: number;
  /**
   * Fields to sort by, in order: 1 ascending, -1 descending. Missing values sort
   * last. Ties, and the default order, are `_createdAt` then `id`.
   */
  sort?: Record<string, 1 | -1>;
}

export interface InsertOptions {
  /** Use this id instead of a generated one; fails with DocumentExistsError if it is taken. */
  id?: string;
}

export interface UpdateOptions {
  /** Only update if the document still has this etag. */
  etag?: string;
}

export interface LogEvent {
  level: 'warn' | 'error';
  message: string;
  error?: unknown;
}

/** Receives problems that do not fail the current call. Default: `console.warn`. */
export type Logger = (event: LogEvent) => void;
