// Coin flips for the game tracker, from the browser's cryptographic random source (not Math.random).
// One random byte's lowest bit is an exact 50/50: 256 values split evenly into odd and even.
export type Side = 'Heads' | 'Tails';
export function flipCoin(rng: (a: Uint8Array) => Uint8Array = a => crypto.getRandomValues(a)): Side {
  const b = rng(new Uint8Array(1));
  return (b[0] & 1) === 0 ? 'Heads' : 'Tails';
}
