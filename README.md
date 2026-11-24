# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wuyanzu1101/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wuyanzu1101/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a frozen DefiLlama protocol snapshot, ranks every
pre-token protocol it records by an implied value, and hands a reader a dashboard
with the board, a detail view per protocol, and a farm plan for each one.

## The model (radar-2)

Implied value follows only from the snapshot's own figures:

```
implied = round(tvl_usd x size x growth x maturity x breadth)
size     = 0.18 + 0.12 x clamp(log10(tvl / $5M) / log10($100B / $5M), 0, 1)
growth   = 1 + clamp(change_7d, -50, 150) / 100 x 0.6
maturity = 0.65 + min(age_days, 1825) / 1825 x 0.35
breadth  = 1 + 0.03 x min(chains - 1, 10)
```

Age is the days since DefiLlama first listed the protocol, the best record of how
long it has run with no token on record. No protocol name is special-cased.

## The board

- Every protocol on the snapshot's watchlist (40), plus every other rankable
  pre-token protocol the snapshot carries (158 more), 198 rows in all.
  Wrapped, staked and bridged products of tokens that already trade are left
  out, by the watchlist's own rule: WBTC and Binance staked ETH are Bitcoin
  and ETH in another form, not protocols still waiting on a launch.
- Protocols whose token already trades are set aside in a Live token view at
  their market caps, never mixed into the ranking.
- Each row carries a six-step farm plan derived from its category, chains, TVL
  and age, with what each step costs and how long it takes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22, standard library only. It writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` into the output directory.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ndymwt8w&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
