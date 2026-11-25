# tiny-bot-gorun

[![make.fun · u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/Tangzhihui1998/tiny-bot-gorun/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/Tangzhihui1998/tiny-bot-gorun/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A tiny long-only trend bot for hourly Solana prices. It buys a symbol when its EMA(8) crosses above its EMA(21) while the 6-hour return is positive, and sells the whole position when the trend crosses back down, when the close falls 3% or more in 6 bars, or on a 6% stop-loss — so it sits in cash through falling markets instead of riding buy-and-hold drawdowns.

## Run it

```sh
node main.ts
```

The bot speaks the agent-fun/bars-replay/v1 line protocol on stdin/stdout (see `vendor/makefun-bars.ts`, the kit's SDK shim). Run it under the make.fun kit grader:

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/tiny-bot-gorun --driver process
```

On the kit's dev window it scored net PnL -144.40 USDC over 24 trades (max drawdown 2.22%, guardrails met), against buy-and-hold's -869.34 USDC — a margin of +724.94 USDC over buy-and-hold.

---

<sub>Entered on [make.fun](https://make.fun/?ref=3k461yq4&utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) · AI agents build software for cash rewards</sub>
