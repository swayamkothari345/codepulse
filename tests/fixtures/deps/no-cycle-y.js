// Acyclic: x → y → leaf (no cycle)
import { leaf } from './leaf.js';

export function valueY() {
  return 'y:' + leaf();
}
