// Token Radar's model: one frozen snapshot of the protocol universe in, one ranked board out.
//
// A protocol earns a place on the board when the snapshot records no token for it and the
// watchlist's own rule keeps it: not an exchange, not a versioned pool, and not a wrapped,
// staked or bridged product of a token that already trades. The live-token protocols are set
// apart in their own view at the market's own values, never mixed into the ranking.
//
// The implied value is a claim about what a token would be worth if the protocol kept its
// record, built only from the snapshot's own figures, through four factors:
//
//   size      a multiple on TVL, 0.18 at the snapshot's $5M floor, rising with log TVL to
//             0.30 at $100B: deeper liquidity and a wider moat are worth more per dollar
//             than a small pool's.
//   growth    seven-day TVL change, clamped to -50%..+150% so one wild week cannot crown a
//             protocol and one bad week cannot bury it; a missing figure counts as no growth.
//   maturity  age in days since DefiLlama first listed the protocol, the best record of how
//             long it has run with no token on record: a longer run means more pent-up value
//             if a token ever comes. Unknown age counts as 365 days.
//   breadth   one extra chain adds 3%, up to 30% for eleven or more chains.
//
//   implied = max(1, round(tvl_usd * size * growth * maturity * breadth))
//
// No protocol name is ever special-cased: the same scorer ranks every row, and the dashboard
// recomputes each row from the same figures so the page and board.json agree.

/** One protocol as the sealed snapshot records it: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tuning, as the dashboard states it. */
export interface ModelConstants {
  size_floor: number;
  size_range: number;
  size_ref_tvl: number;
  size_ref_top: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  size_floor: 0.18,
  size_range: 0.12,
  size_ref_tvl: 5_000_000,
  size_ref_top: 100_000_000_000,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1825,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_chains: 10,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    size_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  size_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const MS_PER_DAY = 86_400_000;

/** Round to four decimals, for the multipliers the board carries. */
const to4dp = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, or `fallback` when the value is missing or not a number. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listed` to `asOf`, never below zero; null when either date is absent or bad. */
export function daysListed(asOf: string, listed: string | null): number | null {
  if (listed === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listed}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

/** The size multiple: 0.18 at the snapshot's $5M floor, rising with log TVL to 0.30 at $100B. */
export function sizeFactor(tvlUsd: number, model: ModelConstants): number {
  const span = Math.log10(model.size_ref_top / model.size_ref_tvl);
  const here = Math.log10(Math.max(tvlUsd, model.size_ref_tvl) / model.size_ref_tvl);
  return model.size_floor + model.size_range * Math.min(1, Math.max(0, here / span));
}

/** One protocol's score under `model`: its four factors and its implied value. */
export interface Score {
  value: number;
  size: number;
  growthPct: number;
  growth: number;
  maturity: number;
  breadth: number;
  age: number | null;
}

/** Score one protocol: four factors from its own figures, then the implied value. */
export function scoreProtocol(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): Score {
  const age = daysListed(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, numOr(protocol.change_7d, 0)));
  const growth = 1 + (growthPct / 100) * model.growth_weight;
  const aged = age ?? model.unknown_age_days;
  const maturity = model.maturity_floor + (Math.min(Math.max(aged, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadth = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const size = sizeFactor(protocol.tvl_usd, model);
  const value = Math.max(1, Math.round(protocol.tvl_usd * size * growth * maturity * breadth));
  return { value, size, growthPct, growth, maturity, breadth, age };
}

/** A name ending in a release marker (V2, v2, 2.0) is a pool of another protocol, not a launch of its own. */
const VERSION_MARK = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a bridged, staked or exchange product of a token that already trades. */
const LEFT_OUT = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name that starts with an exchange's name is the exchange's own product. */
const EXCHANGE_LEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word wrapped, staked or staking marks a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether the board may rank a protocol: pre-token, and none of the watchlist rule's
 * exclusions — not an exchange, not a versioned pool, not a wrapped, staked or bridged
 * product of a token that already trades, and not an exchange's own product. The watchlist
 * itself passes this rule by construction, so every watchlist slug stays rankable.
 */
export function mayRank(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (LEFT_OUT.has(p.category ?? '')) return false;
  if (VERSION_MARK.test(p.name)) return false;
  if (EXCHANGE_LEAD.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  return true;
}

/** The chain a protocol names first, or a neutral phrase when it names none. */
function homeChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, from the protocol's own TVL. */
function stakeFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One action rule: the category words it matches and the action it writes. First match wins. */
interface ActionRule {
  keys: string[];
  write: (name: string, capital: number, chain: string) => string;
}

const ACTION_RULES: ActionRule[] = [
  { keys: ['lend', 'cdp', 'collateral'], write: (n, c, ch) => `Lend $${c} of USDC into ${n}'s market on ${ch} and leave the deposit earning.` },
  { keys: ['dex', 'yield', 'leveraged farm', 'liquidity manager', 'farm'], write: (n, c, ch) => `Add $${c} of liquidity to ${n}'s deepest pool on ${ch} and hold the LP receipt.` },
  { keys: ['bridge'], write: (n, c, ch) => `Bridge $${c} of USDC into ${ch} with ${n}, then put the bridged funds to work inside its app.` },
  { keys: ['staking', 'restak'], write: (n, c, ch) => `Stake $${c} of the chain's native asset through ${n} and hold the liquid receipt token.` },
  { keys: ['perpetual', 'derivative', 'options vault', 'basis trading'], write: (n, c, ch) => `Post $${c} of USDC as margin on ${n} and open one small hedged position.` },
  { keys: ['prediction'], write: (n, c, ch) => `Fund your account with $${c} and take one small position in an active market on ${n}.` },
  { keys: ['curator', 'allocator'], write: (n, c, ch) => `Deposit $${c} into a ${n} vault on ${ch} and hold the vault shares.` },
  { keys: ['rwa'], write: (n, c, ch) => `Mint $${c} of ${n}'s yield-bearing asset on ${ch} and hold it.` },
  { keys: ['stable'], write: (n, c, ch) => `Mint $${c} of the stable asset through ${n} on ${ch} and keep the collateral ratio healthy.` },
  { keys: ['insurance'], write: (n, c, ch) => `Buy $${c} of cover from ${n} on ${ch} and keep the policy active.` },
  { keys: ['aggregator'], write: (n, c, ch) => `Deposit $${c} into ${n}'s top vault on ${ch} and let it compound.` },
  { keys: ['payment', 'card'], write: (n, c, ch) => `Top up $${c} through ${n} on ${ch} and use it for one real payment each week.` },
];

/** Whether a lowercased category carries any of a rule's words. */
function hits(category: string, keys: string[]): boolean {
  for (const k of keys) if (category.includes(k)) return true;
  return false;
}

/** The category's main action, in words a farmer can follow. */
function actionText(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of ACTION_RULES) {
    if (hits(c, rule.keys)) return rule.write(p.name, capital, chain);
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/** One weekly-habit rule: the category words it matches and the habit it writes. First match wins. */
interface WeeklyRule {
  keys: string[];
  text: string;
}

const WEEKLY_RULES: WeeklyRule[] = [
  { keys: ['dex', 'yield', 'farm', 'aggregator'], text: 'Swap a small amount through the pool each week so the wallet shows repeat use, not one deposit.' },
  { keys: ['lend', 'cdp', 'collateral'], text: 'Borrow a small amount against the deposit once, repay it, and repeat the cycle each month.' },
  { keys: ['bridge'], text: 'Bridge a small amount back and forth once a week so the wallet keeps showing bridge volume.' },
  { keys: ['staking', 'restak'], text: 'Claim any staking rewards weekly and restake them instead of letting them sit idle.' },
  { keys: ['perpetual', 'derivative', 'prediction'], text: 'Close and reopen one small position each week so the wallet shows steady trading activity.' },
  { keys: ['curator', 'allocator', 'rwa'], text: 'Top the vault up with a small amount each week so the wallet shows a growing position.' },
];

/** The weekly qualifying action, fitted to what the protocol actually does. */
function weeklyText(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of WEEKLY_RULES) {
    if (hits(c, rule.keys)) return rule.text;
  }
  return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = homeChain(p);
  const capital = stakeFor(p);
  const hold = holdFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: 'Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionText(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyText(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from its official site and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** One step as a single string: action, then cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The protocols the board ranks, strongest first, with ranks 1..n and strictly falling values. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const picked = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked.
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) picked.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, floor or not. A chosen protocol
  // stays chosen; nothing here replaces a watchlist row.
  for (const p of snapshot.protocols) {
    if (!picked.has(p.slug) && mayRank(p)) picked.set(p.slug, p);
  }

  const scored = [...picked.values()].map((p) => ({ p, score: scoreProtocol(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.score.value - a.score.value || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // A ranking that ties two rows on the same dollar is no ranking: keep the model's numbers, but
  // shave $1 off a row that would otherwise equal the one above it, so values strictly fall.
  let above = Number.POSITIVE_INFINITY;
  return scored.map(({ p, score }, i) => {
    let value = score.value;
    if (value >= above) value = Math.max(1, above - 1);
    above = value;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: score.age,
      implied_value_usd: value,
      model: {
        size_multiple: to4dp(score.size),
        growth_pct: score.growthPct,
        growth_multiplier: to4dp(score.growth),
        maturity_multiplier: to4dp(score.maturity),
        breadth_multiplier: to4dp(score.breadth),
        age_days: score.age,
      },
      farm_steps: farmSteps(p, score.age).map(stepText),
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const live = snapshot.protocols.filter((p) => !recordsNoToken(p) && p.category !== 'CEX');
  live.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return live.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
function compactRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    size_multiple: row.model.size_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    watchlist: onWatchlist,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => compactRow(r, watchlist.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** One protocol out of a raw value, refused unless it carries a slug, a name and a TVL. */
function readProtocol(v: unknown, i: number): SnapshotProtocol {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
  const p = v as Record<string, unknown>;
  if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
    throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
  }
  return {
    slug: p.slug,
    name: p.name,
    category: typeof p.category === 'string' ? p.category : null,
    chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
    tvl_usd: p.tvl_usd,
    change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
    mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols: o.protocols.map((v, i) => readProtocol(v, i)),
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row floor`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
