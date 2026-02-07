/**
 * Supported query operators
 */
export type QueryOperator =
  | '$eq'
  | '$ne'
  | '$gt'
  | '$gte'
  | '$lt'
  | '$lte'
  | '$in'
  | '$nin';

/**
 * Query value can be direct value or operator object
 */
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

/**
 * Query filter for type-safe queries
 */
export type QueryFilter<T> = {
  [K in keyof T]?: QueryValue<T[K]>;
};

/**
 * Query options for pagination and sorting
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
}

/**
 * Update options with optimistic locking
 */
export interface UpdateOptions {
  etag?: string;
}
