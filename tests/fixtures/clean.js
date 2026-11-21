/**
 * Fixture: clean, well-structured JavaScript.
 * Should produce zero issues when analyzed.
 */

export function add(a, b) {
  return a + b;
}

export function multiply(a, b) {
  return a * b;
}

export function formatName(first, last) {
  if (!first || !last) return '';
  return `${first} ${last}`;
}

export function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export class Calculator {
  constructor() {
    this.history = [];
  }

  add(a, b) {
    const result = a + b;
    this.history.push({ op: 'add', a, b, result });
    return result;
  }

  subtract(a, b) {
    const result = a - b;
    this.history.push({ op: 'subtract', a, b, result });
    return result;
  }

  clearHistory() {
    this.history = [];
  }

  getLastResult() {
    return this.history[this.history.length - 1]?.result ?? null;
  }
}

export async function fetchUser(id) {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch user ${id}: ${response.status}`);
  }
  return response.json();
}
