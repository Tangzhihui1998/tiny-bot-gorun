// Tiny trend bot for make.fun's "Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana".
//
// Strategy: long-only EMA(8)/EMA(21) crossover, one symbol at a time.
//   - Entry: on a bar's close, EMA(8) crosses above EMA(21) on a symbol the bot
//     does not hold, the bar has volume (a zero-volume bar signals nothing),
//     and the close is above the close 6 bars ago (no dead-cat-bounce entries
//     while the price is still falling).
//   - Exit: the whole position when EMA(8) crosses back below EMA(21), when
//     the close fell 3% or more in the last 6 bars (sharp-drop exit, faster
//     than the slow EMA cross), or when the position is worth 6% under its
//     cost at the close (stop-loss).
//   - Sizing: each buy is equity / 7 (one slice per universe symbol), capped by
//     the harness weight cap and by the cash on hand; never more than the
//     universe size in positions, so the bot can be fully invested when every
//     symbol trends up and sits in cash when none does.
//   - Orders fill at the next bar's open, so sells are sent first and buys are
//     sized from the cash actually on hand (a sell's proceeds never fund a buy
//     of the same reply).
//
// Why this beats buy-and-hold: buy-and-hold rides every drawdown to the end.
// This bot holds only symbols in an uptrend and cuts them on a cross down, so
// in a falling window it spends most bars in cash, and in a rising window it
// is invested in the trending symbols. On the kit's dev window (a falling
// market) the house EMA-crossover baseline lost far less than buy-and-hold;
// the stop-loss is extra insurance for the unseen 3-day final window. No
// take-profit: winners are left to run until the trend turns, so a strong
// rally is not cut short.
//
// Deterministic: float64 EMAs on + - * / alone, no clock, no environment, no
// randomness, so the two grading runs produce identical orders.

import { BPS, runBars, type Bar, type BuyInput, type OrderInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST_BARS = 8;
const SLOW_BARS = 21;
/** Entry filter / sharp-drop exit lookback, in bars. */
const MOM_BARS = 6;
/** Sharp-drop exit: sell when the close is 3% or more under the close MOM_BARS back. */
const DROP_PCT = 0.03;
/** Stop-loss: sell when a position is worth this fraction of its cost. */
const STOP_NUM = 94n;
const STOP_DEN = 100n;
/** Each order caps its slippage at 1% past the close it was decided on. */
const MAX_SLIPPAGE_BPS = 100;

/** One EMA: the closes it has seen until it starts, then its value. */
interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

interface Series {
  fast: Ema;
  slow: Ema;
  /** fast - slow after the symbol's previous bar, once both are set. */
  prevGap: number | null;
  /** Recent closes (USDC per unit), oldest first; kept to MOM_BARS + 1. */
  closes: number[];
}

const series = new Map<string, Series>();
const priceScales = new Map<string, number>();

function step(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
}

/** Fold one bar into its symbol's EMAs; returns the gap before and after it. */
function push(bar: Bar): { s: Series; prevGap: number | null; gap: number | null; closeAgo: number | null } {
  let s = series.get(bar.symbol);
  if (s === undefined) {
    s = {
      fast: { span: FAST_BARS, warm: [], value: null },
      slow: { span: SLOW_BARS, warm: [], value: null },
      prevGap: null,
      closes: [],
    };
    series.set(bar.symbol, s);
  }
  const prevGap = s.prevGap;
  const scale = priceScales.get(bar.symbol) ?? 0;
  const close = Number(bar.c) / 10 ** scale;
  s.closes.push(close);
  if (s.closes.length > MOM_BARS + 1) s.closes.shift();
  step(s.fast, close);
  step(s.slow, close);
  const gap = s.fast.value !== null && s.slow.value !== null ? s.fast.value - s.slow.value : null;
  if (gap !== null) s.prevGap = gap;
  // The close MOM_BARS bars ago, once that many closes are on record.
  const closeAgo = s.closes.length > MOM_BARS ? s.closes[0] : null;
  return { s, prevGap, gap, closeAgo };
}

await runBars({
  onHello(state) {
    for (const sym of state.hello.symbols) priceScales.set(sym.symbol, sym.price_scale);
  },
  onBatch(state, batch) {
    // Update every symbol's indicators from this batch's bars, warm-up bars
    // included, but send no order while warming up: the replay rejects them.
    const decided: { symbol: string; prevGap: number | null; gap: number | null; close: number; closeAgo: number | null; volume: string | null }[] = [];
    for (const bar of batch.bars) {
      const { prevGap, gap, closeAgo } = push(bar);
      const scale = priceScales.get(bar.symbol) ?? 0;
      decided.push({ symbol: bar.symbol, prevGap, gap, close: Number(bar.c) / 10 ** scale, closeAgo, volume: bar.v });
    }
    if (state.warmingUp) return [];
    const { caps, fees } = state.hello;
    const nSlots = Math.min(state.hello.symbols.length, caps.max_open_positions);
    const slice = state.equity / BigInt(nSlots);
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    const stake = slice < byWeight ? slice : byWeight;

    const sells: SellInput[] = [];
    const buys: BuyInput[] = [];
    for (const { symbol, prevGap, gap, close, closeAgo, volume } of decided) {
      if (gap === null || prevGap === null) continue;
      // A zero-volume bar signals nothing (stale price); a bar with no volume
      // recorded (v null) is not held back.
      if (volume !== null && BigInt(volume) === 0n) continue;
      const held = state.positions.get(symbol);
      if (held !== undefined) {
        const crossedDown = gap < 0 && prevGap >= 0;
        const worth = state.value(symbol, held.qty);
        const stopped = worth * STOP_DEN <= held.cost * STOP_NUM;
        // Sharp-drop exit: the close fell 3% or more in the last 6 bars.
        const dropped = closeAgo !== null && close <= closeAgo * (1 - DROP_PCT);
        if (crossedDown || stopped || dropped) {
          sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      } else if (gap > 0 && prevGap <= 0) {
        // Entry filter: only buy the cross when the price is not still
        // falling over the last 6 bars (no dead-cat-bounce entries).
        if (closeAgo !== null && close <= closeAgo) continue;
        buys.push({ side: 'buy', symbol, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    }
    // Sells first, then buys sized from the cash on hand (sells settle at the
    // next open and fund later buys, never this reply's). Cap the reply at
    // max_orders_per_bar and drop buys below the minimum notional.
    const orders: OrderInput[] = [];
    for (const sell of sells) {
      if (orders.length >= caps.max_orders_per_bar) break;
      orders.push(sell);
    }
    let cashLeft = state.cash;
    let room = nSlots - (state.positions.size - sells.length);
    for (const buy of buys) {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) break;
      const amount = stake < cashLeft ? stake : cashLeft;
      if (amount < BigInt(fees.min_notional_quote_units)) continue;
      orders.push({ ...buy, notional_quote_units: amount });
      cashLeft -= amount;
      room -= 1;
    }
    return orders;
  },
});
