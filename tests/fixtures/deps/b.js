// Part of a 3-node cycle: a → b → c → a
import { valueC } from './c.js';

export function valueB() {
  return 'b:' + valueC();
}
