/**
 * Fixture: intentionally problematic JavaScript.
 * Used to verify that analyzers correctly detect real issues.
 */

// --- Too many parameters + deep nesting + magic numbers ---
export function processOrder(order, user, inventory, pricing, discounts, shipping) {
  if (order) {
    if (user) {
      if (user.verified) {
        if (inventory) {
          if (inventory.available) {
            if (order.items && order.items.length > 0) {
              let total = 0;
              for (let i = 0; i < order.items.length; i++) {
                const item = order.items[i];
                if (item.quantity > 0) {
                  if (item.price > 500) {
                    total += item.price * item.quantity * 0.9;
                  } else if (item.price > 100) {
                    total += item.price * item.quantity * 0.95;
                  } else {
                    total += item.price * item.quantity;
                  }
                }
              }
              if (total > 1000) {
                total = total * 0.85;
              } else if (total > 500) {
                total = total * 0.90;
              }
              return total;
            }
          }
        }
      }
    }
  }
  return 0;
}

// --- Empty catch block ---
export async function fetchData(url) {
  try {
    const response = await fetch(url);
    return response.json();
  } catch (e) {
    // silently fail — intentional smell
  }
}

// --- Near-duplicate of fetchData (duplication target) ---
export async function fetchUserData(url) {
  try {
    const response = await fetch(url);
    return response.json();
  } catch (e) {
    // silently fail — intentional smell
  }
}

// --- High cyclomatic complexity ---
export function categorise(value, type, region, role) {
  if (type === 'A') {
    if (region === 'US') {
      if (role === 'admin') return 'US-A-admin';
      else if (role === 'user') return 'US-A-user';
      else return 'US-A-other';
    } else if (region === 'EU') {
      if (role === 'admin') return 'EU-A-admin';
      else return 'EU-A-user';
    }
  } else if (type === 'B') {
    if (region === 'US') return 'US-B';
    else if (region === 'EU') return 'EU-B';
    else return 'OTHER-B';
  } else if (type === 'C') {
    return value > 0 ? 'C-positive' : 'C-nonpositive';
  }
  return 'unknown';
}

// --- Magic numbers ---
export function calculateTax(amount) {
  if (amount > 50000) return amount * 0.37;
  if (amount > 40000) return amount * 0.32;
  if (amount > 32000) return amount * 0.22;
  if (amount > 10000) return amount * 0.12;
  return amount * 0.10;
}

// --- Unused variable ---
export function greet(name) {
  const unusedPrefix = 'Hello'; // declared but never used
  return `Hi, ${name}`;
}
