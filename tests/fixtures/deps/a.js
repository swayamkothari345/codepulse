// Part of a 3-node cycle: a → b → c → a
import { valueB } from './b.js';

export function valueA() {
  return 'a:' + valueB();
}
