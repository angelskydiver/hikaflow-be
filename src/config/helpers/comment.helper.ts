export function filterHighPriorityComments(comments) {
  const priorityOrder = { High: 3, Medium: 2, Low: 1 };
  const commentMap = new Map();

  comments.forEach((comment) => {
    const key = `${comment.file}:${comment.line}`;
    if (
      !commentMap.has(key) ||
      priorityOrder[comment.priority] >
        priorityOrder[commentMap.get(key).priority]
    ) {
      commentMap.set(key, comment);
    }
  });

  return Array.from(commentMap.values());
}
