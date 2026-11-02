// TH16 0x402be0：两次 16 位递推，拼接旋转前的值。依据见 docs/anm-random.md。
export function createPrng(seed = 0) {
  let state = seed & 0xffff;
  function nextHalf() {
    const t = ((state ^ 0x9630) - 0x6553) & 0xffff;
    state = ((t << 2) | (t >>> 14)) & 0xffff;
    return t;
  }
  return () => ((nextHalf() << 16) | nextHalf()) >>> 0;
}
