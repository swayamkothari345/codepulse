// Acyclic: x → y → leaf (no cycle)
import { valueY } from './no-cycle-y.js';

export function valueX() {
  return 'x:' + valueY();
}
