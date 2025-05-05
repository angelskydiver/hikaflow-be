/**
 * Maps fields between older and newer schema versions
 * @param doc Document with potential field name mismatches
 * @returns Document with standardized field names
 */
export function mapDocumentFields(doc: any): any {
  if (!doc) return doc;

  return {
    ...doc,
    // Handle name/fileName mapping
    name: doc.fileName || doc.name,
    fileName: doc.fileName || doc.name,

    // Handle fullPath/filePath mapping
    fullPath: doc.filePath || doc.fullPath,
    filePath: doc.filePath || doc.fullPath,

    // Handle fileRelativePath mapping
    fileRelativePath: doc.fileRelativePath || doc.filePath || doc.fullPath,
  };
}

/**
 * Maps an array of documents to standardize field names
 * @param docs Array of documents with potential field name mismatches
 * @returns Array of documents with standardized field names
 */
export function mapDocumentsArray(docs: any[]): any[] {
  if (!docs) return docs;
  return docs.map(mapDocumentFields);
}

/**
 * Decorator function that adds a @ts-ignore comment before a property
 * to ignore type checking for that property
 * @param target
 * @param propertyKey
 */
export function IgnoreTypeCheck(target: any, propertyKey: string) {
  // This decorator doesn't actually do anything at runtime
  // It's just a marker for where we need to ignore type checking
  // The actual ignoring is done by adding // @ts-ignore comments in the code
}
