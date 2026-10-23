// Serialize independent writes; duplicate taps on the same pending action share its result.
// A failed action must not prevent later work from running.
export function createMutationQueue(onPendingChange = () => {}) {
  let tail = Promise.resolve();
  const pending = new Map();
  const publish = () => onPendingChange([...pending.keys()]);
  return {
    get size() { return pending.size; },
    enqueue(actionKey, task) {
      const key = actionKey || Symbol("save");
      if (pending.has(key)) return pending.get(key);
      const result = tail.then(task);
      const settled = result.finally(() => {
        pending.delete(key);
        publish();
      });
      pending.set(key, settled);
      publish();
      tail = settled.catch(() => {});
      return settled;
    },
  };
}
