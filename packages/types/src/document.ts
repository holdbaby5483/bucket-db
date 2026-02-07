/**
 * Base document type with system fields
 */
export interface Document {
  id: string;
  _etag?: string;
  _createdAt?: string;
  _updatedAt?: string;
}

/**
 * Type for inserting new documents (omits system fields)
 */
export type InsertDocument<T extends Document> = Omit<
  T,
  'id' | '_etag' | '_createdAt' | '_updatedAt'
>;

/**
 * Type for updating documents (partial update without id)
 */
export type UpdateDocument<T extends Document> = Partial<Omit<T, 'id'>>;
