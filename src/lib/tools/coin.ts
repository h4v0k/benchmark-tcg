// Coin flips for the game tracker, from the browser's cryptographic random source (not Math.random).
// One random byte's lowest bit is an exact 50/50: 256 values split evenly into odd and even.
export type CoinSide = 'Heads' | 'Tails';
type Rng = (a: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
export function flipCoin(rng: Rng = a => crypto.getRandomValues(a)): CoinSide {
  const b = rng(new Uint8Array(new ArrayBuffer(1)));
  return (b[0] & 1) === 0 ? 'Heads' : 'Tails';
}
