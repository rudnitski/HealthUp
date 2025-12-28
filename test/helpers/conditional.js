/**
 * Conditionally run or skip a test suite based on a condition
 * @param {boolean} condition - If true, run suite; if false, skip it
 * @param {string} name - Test suite name
 * @param {function} fn - Test suite function
 */
export const describeIf = (condition, name, fn) =>
  condition ? describe(name, fn) : describe.skip(name, fn);
