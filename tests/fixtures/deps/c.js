// Part of a 3-node cycle: a → b → c → a
import { valueA } from './a.js';

export function valueC() {
  return 'c:' + valueA();
}
