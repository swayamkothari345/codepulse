// Imports from the cycle (but is not part of it)
import { valueA } from './a.js';
import { leaf } from './leaf.js';

export function run() {
  return valueA() + leaf();
}
