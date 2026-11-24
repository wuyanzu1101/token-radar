// Token Radar's dashboard, rendered from window.RADAR (written beside dashboard/ by main.ts):
// the ranked board, a filterable table, a per-protocol detail drawer with the model's own inputs
// and the protocol's farm plan, and the live-token protocols set aside. No network: every byte
// it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var mount = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /** A dollar amount in the board's short form: $683.4M, $2.75B, $850, $42. */
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return moneyFmt.format(n);
  }

  /** A percentage with its sign: +2.37%, -8.29%, or n/a when the snapshot carries none. */
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  /** An age in days as the board shows it: 1.5y once a year has passed, otherwise 42d. */
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model, recomputed in the page from the snapshot figures the row carries: the page checks
  // the number board.json carries, so the page's code and the board's data are visibly the same
  // arithmetic. Same factor order as lib/model.ts, so the result is bit-identical.
  function recompute(row, model) {
    var size = model.size_floor + model.size_range * Math.min(1, Math.max(0, Math.log10(Math.max(row.tvl_usd, model.size_ref_tvl) / model.size_ref_tvl) / Math.log10(model.size_ref_top / model.size_ref_tvl)));
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + model.breadth_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_chains);
    return Math.max(1, Math.round(row.tvl_usd * size * growthMult * maturity * breadth));
  }

  /**
   * Build one element. `spec` carries:
   *   cls   - the class attribute,   txt - plain text content,
   *   html  - raw inner HTML,       attrs - other attributes as {name: value},
   *   on    - handlers as {event: fn}.
   * Null and undefined values are skipped; children may be strings, nodes or arrays.
   */
  function node(tag, spec) {
    var el = document.createElement(tag);
    if (spec) {
      if (spec.cls) el.className = spec.cls;
      if (spec.txt !== undefined && spec.txt !== null) el.textContent = spec.txt;
      if (spec.html !== undefined && spec.html !== null) el.innerHTML = spec.html;
      if (spec.attrs) {
        Object.keys(spec.attrs).forEach(function (k) {
          var v = spec.attrs[k];
          if (v !== null && v !== undefined) el.setAttribute(k, v);
        });
      }
      if (spec.on) {
        Object.keys(spec.on).forEach(function (ev) { el.addEventListener(ev, spec.on[ev]); });
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid === null || kid === undefined) continue;
      if (Array.isArray(kid)) kid.forEach(function (c) { if (c) el.appendChild(c); });
      else if (typeof kid === 'string') el.appendChild(document.createTextNode(kid));
      else el.appendChild(kid);
    }
    return el;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the weekly habit, the capital, the hold and every cost and time. No
  // name is special-cased. Exposed on window.__radar so the entry's own checks can compare it
  // with board.json.
  function homeChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function stakeFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function hits(category, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (category.indexOf(keys[i]) >= 0) return true;
    }
    return false;
  }
  var ACTION_RULES = [
    { keys: ['lend', 'cdp', 'collateral'], write: function (n, c, ch) { return 'Lend $' + c + " of USDC into " + n + "'s market on " + ch + ' and leave the deposit earning.'; } },
    { keys: ['dex', 'yield', 'leveraged farm', 'liquidity manager', 'farm'], write: function (n, c, ch) { return 'Add $' + c + " of liquidity to " + n + "'s deepest pool on " + ch + ' and hold the LP receipt.'; } },
    { keys: ['bridge'], write: function (n, c, ch) { return 'Bridge $' + c + ' of USDC into ' + ch + ' with ' + n + ', then put the bridged funds to work inside its app.'; } },
    { keys: ['staking', 'restak'], write: function (n, c, ch) { return 'Stake $' + c + " of the chain's native asset through " + n + ' and hold the liquid receipt token.'; } },
    { keys: ['perpetual', 'derivative', 'options vault', 'basis trading'], write: function (n, c, ch) { return 'Post $' + c + ' of USDC as margin on ' + n + ' and open one small hedged position.'; } },
    { keys: ['prediction'], write: function (n, c, ch) { return 'Fund your account with $' + c + ' and take one small position in an active market on ' + n + '.'; } },
    { keys: ['curator', 'allocator'], write: function (n, c, ch) { return 'Deposit $' + c + ' into a ' + n + ' vault on ' + ch + ' and hold the vault shares.'; } },
    { keys: ['rwa'], write: function (n, c, ch) { return 'Mint $' + c + " of " + n + "'s yield-bearing asset on " + ch + ' and hold it.'; } },
    { keys: ['stable'], write: function (n, c, ch) { return 'Mint $' + c + ' of the stable asset through ' + n + ' on ' + ch + ' and keep the collateral ratio healthy.'; } },
    { keys: ['insurance'], write: function (n, c, ch) { return 'Buy $' + c + ' of cover from ' + n + ' on ' + ch + ' and keep the policy active.'; } },
    { keys: ['aggregator'], write: function (n, c, ch) { return 'Deposit $' + c + " into " + n + "'s top vault on " + ch + ' and let it compound.'; } },
    { keys: ['payment', 'card'], write: function (n, c, ch) { return 'Top up $' + c + ' through ' + n + ' on ' + ch + ' and use it for one real payment each week.'; } }
  ];
  function actionText(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < ACTION_RULES.length; i++) {
      if (hits(c, ACTION_RULES[i].keys)) return ACTION_RULES[i].write(p.name, capital, chain);
    }
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  }
  var WEEKLY_RULES = [
    { keys: ['dex', 'yield', 'farm', 'aggregator'], text: 'Swap a small amount through the pool each week so the wallet shows repeat use, not one deposit.' },
    { keys: ['lend', 'cdp', 'collateral'], text: 'Borrow a small amount against the deposit once, repay it, and repeat the cycle each month.' },
    { keys: ['bridge'], text: 'Bridge a small amount back and forth once a week so the wallet keeps showing bridge volume.' },
    { keys: ['staking', 'restak'], text: 'Claim any staking rewards weekly and restake them instead of letting them sit idle.' },
    { keys: ['perpetual', 'derivative', 'prediction'], text: 'Close and reopen one small position each week so the wallet shows steady trading activity.' },
    { keys: ['curator', 'allocator', 'rwa'], text: 'Top the vault up with a small amount each week so the wallet shows a growing position.' }
  ];
  function weeklyText(p) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < WEEKLY_RULES.length; i++) {
      if (hits(c, WEEKLY_RULES[i].keys)) return WEEKLY_RULES[i].text;
    }
    return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
  }
  function renderStep(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function planFor(p) {
    var chain = homeChain(p);
    var capital = stakeFor(p);
    var hold = holdFor(p.age_days);
    return [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionText(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyText(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page from its official site and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(renderStep);
  }
  window.__radar = { farmSteps: planFor, impliedOf: recompute, state: state };

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.watchlistOnly = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('wl', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function orderedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function topBar() {
    return node('header', { cls: 'top' },
      node('div', { cls: 'brand' }, node('span', { cls: 'mark' }), node('span', { cls: 'brand-name', txt: 'Token Radar' })),
      node('div', { cls: 'top-meta' },
        node('span', { txt: 'Snapshot ' + DATA.as_of }),
        node('span', { txt: 'DefiLlama protocol index' }),
        node('span', { txt: DATA.model_version + ' model' })
      )
    );
  }

  function intro() {
    return node('section', { cls: 'lede' },
      node('div', null,
        node('h1', { txt: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        node('p', { txt: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, and every pre-token protocol above it the watchlist leaves out. Implied value is a model, not a promise: it says what a token would be worth if the protocol kept its record, never whether or when one comes.' })
      ),
      node('div', { cls: 'facts' },
        node('div', { cls: 'fact' }, node('span', { txt: 'Watchlist covered' }), node('b', { txt: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        node('div', { cls: 'fact' }, node('span', { txt: 'Pre-token rows scored' }), node('b', { txt: String(DATA.board_size) })),
        node('div', { cls: 'fact' }, node('span', { txt: 'Early rows below the floor' }), node('b', { txt: String(DATA.early_size) })),
        node('div', { cls: 'fact' }, node('span', { txt: 'Live-token protocols set aside' }), node('b', { txt: String(DATA.live_size) }))
      )
    );
  }

  function topThree() {
    var top = DATA.rows.slice(0, 3);
    return node('section', { cls: 'spotlight', attrs: { 'aria-label': 'Top three protocols by implied value' } },
      top.map(function (r) {
        return node('div', { cls: 'spot' },
          node('span', { cls: 'rank', txt: 'RANK ' + r.rank + (r.watchlist ? ' · WATCHLIST' : '') }),
          node('b', { txt: r.name }),
          node('span', { cls: 'num', txt: money(r.implied_value_usd) }),
          node('span', { cls: 'sub', txt: 'TVL ' + money(r.tvl_usd) + ' · ' + pct(r.change_7d) + ' in 7d · ' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') })
        );
      })
    );
  }

  function filters() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; });
    var search = node('input', { attrs: { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' } });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderAll(); });
    var select = node('select', { attrs: { id: 'category', 'aria-label': 'Filter by category' } },
      node('option', { attrs: { value: 'all' }, txt: 'All categories' }),
      categories.map(function (c) { return node('option', { attrs: { value: c, selected: c === state.category ? 'selected' : null }, txt: c }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); renderAll(); });
    var chainSelect = node('select', { attrs: { id: 'chain', 'aria-label': 'Filter by chain' } },
      node('option', { attrs: { value: 'all' }, txt: 'All chains' }),
      chains.map(function (c) { return node('option', { attrs: { value: c, selected: c === state.chain ? 'selected' : null }, txt: c + ' (' + chainCounts[c] + ')' }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); renderAll(); });
    var wl = node('input', { attrs: { type: 'checkbox', id: 'wl', checked: state.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' } });
    wl.addEventListener('change', function () { state.watchlistOnly = wl.checked; writeHash(); renderAll(); });
    var pre = node('button', { attrs: { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false' }, txt: 'Pre-token', on: { click: function () { state.tab = 'pre-token'; renderAll(); } } });
    var live = node('button', { attrs: { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false' }, txt: 'Live token', on: { click: function () { state.tab = 'live'; renderAll(); } } });
    return node('div', { cls: 'controls' },
      node('div', { cls: 'field' }, node('label', { attrs: { for: 'q' }, txt: 'Search' }), search),
      node('div', { cls: 'field' }, node('label', { attrs: { for: 'category' }, txt: 'Category' }), select),
      node('div', { cls: 'field' }, node('label', { attrs: { for: 'chain' }, txt: 'Chain' }), chainSelect),
      node('label', { cls: 'check' }, wl, 'Watchlist only'),
      node('div', { cls: 'field' }, node('span', { cls: 'sub', txt: 'Token status' }), node('div', { cls: 'tabs' }, pre, live)),
      node('span', { cls: 'count', txt: state.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortableHead(key, label) {
    return node('th', { attrs: { scope: 'col' } },
      node('button', { attrs: { type: 'button' }, on: { click: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } renderAll(); } } },
        label,
        state.sort === key ? node('span', { attrs: { 'aria-hidden': 'true' }, txt: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardPanel() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return node('div', { cls: 'panel' }, node('div', { cls: 'empty' },
        node('h2', { txt: 'No protocol matches that filter' }),
        node('p', { txt: 'Clear the search or pick another category to see the board again.' }),
        node('button', { cls: 'button primary', attrs: { type: 'button' }, txt: 'Clear filters', on: { click: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; writeHash(); renderAll(); } } })
      ));
    }
    var max = 0;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    if (!max) max = 1;
    var tbody = node('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = node('tr', {
        attrs: { 'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0' },
        on: {
          click: function () { showDetail(r.slug); },
          keydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r.slug); } }
        }
      },
        node('td', { cls: 'num', txt: String(r.rank) }),
        node('td', null, node('div', { cls: 'name' },
          node('b', { txt: r.name }),
          node('span', { cls: 'sub', txt: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        node('td', { cls: 'num', txt: money(r.tvl_usd) }),
        node('td', { cls: 'num ' + growthClass, txt: growth }),
        node('td', { cls: 'num', txt: ageLabel(r.age_days) }),
        node('td', null, node('div', { cls: 'implied' },
          node('div', { cls: 'bar', attrs: { 'aria-hidden': 'true' } }, node('i', { attrs: { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' } })),
          node('span', { cls: 'num', txt: money(r.implied_value_usd) })
        )),
        node('td', null, node('span', { cls: r.watchlist ? 'badge watch' : 'badge', txt: r.watchlist ? 'watchlist · no token' : 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return node('div', { cls: 'panel' },
      node('div', { cls: 'table-wrap' },
        node('table', null,
          node('caption', { cls: 'sub', txt: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          node('thead', null, node('tr', null,
            sortableHead('implied', 'Rank'),
            sortableHead('name', 'Protocol'),
            sortableHead('tvl', 'TVL'),
            sortableHead('growth', '7d'),
            sortableHead('age', 'Age'),
            sortableHead('implied', 'Implied value'),
            node('th', { attrs: { scope: 'col' }, txt: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function livePanel() {
    var tbody = node('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(node('tr', null,
        node('td', { cls: 'num', txt: 'live' }),
        node('td', null, node('div', { cls: 'name' }, node('b', { txt: r.name }), node('span', { cls: 'sub', txt: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        node('td', { cls: 'num', txt: money(r.tvl_usd) }),
        node('td', { cls: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), txt: pct(r.change_7d) }),
        node('td', { cls: 'num', txt: money(r.mcap_usd) }),
        node('td', null, node('span', { cls: 'badge live', txt: 'already trades' }))
      ));
    });
    return node('div', { cls: 'panel' },
      node('div', { cls: 'table-wrap' },
        node('table', null,
          node('caption', { cls: 'sub', txt: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          node('thead', null, node('tr', null, node('th', { attrs: { scope: 'col' }, txt: 'Status' }), node('th', { attrs: { scope: 'col' }, txt: 'Protocol' }), node('th', { attrs: { scope: 'col' }, txt: 'TVL' }), node('th', { attrs: { scope: 'col' }, txt: '7d' }), node('th', { attrs: { scope: 'col' }, txt: 'Market cap' }), node('th', { attrs: { scope: 'col' }, txt: 'Token' }))),
          tbody
        )
      )
    );
  }

  function formulaPanel() {
    var m = DATA.model;
    return node('section', { cls: 'panel model' },
      node('h2', { txt: 'How implied value is computed' }),
      node('p', { cls: 'sub', txt: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      node('div', { cls: 'formula' },
        'implied = round( tvl_usd x size x growth x maturity x breadth )\n' +
        'size     = ' + m.size_floor + ' + ' + m.size_range + ' x clamp( log10(tvl / $' + (m.size_ref_tvl / 1e6) + 'M) / log10($' + (m.size_ref_top / 1e9) + 'B / $' + (m.size_ref_tvl / 1e6) + 'M), 0, 1 )   [0.18 at $5M, 0.30 at $100B]\n' +
        'growth   = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + '\n' +
        'maturity = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + '   [age: days since first listed]\n' +
        'breadth  = 1 + ' + m.breadth_per_chain + ' x min(chains - 1, ' + m.breadth_max_chains + ')'
      ),
      node('p', { cls: 'sub', txt: 'TVL, seven-day growth and chain count come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token on record; an unlisted age uses ' + m.unknown_age_days + ' days. Exchanges, versioned pools and wrapped, staked or bridged products are left out of the ranking: each is a product of a token that already trades, not a protocol still waiting on a launch. The live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = node('dialog', { cls: 'detail', attrs: { id: 'detail', 'aria-labelledby': 'detail-title' } });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function showDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = planFor(row);
    var recomputed = recompute(row, DATA.model);
    var check = recomputed === row.implied_value_usd
      ? 'the same number board.json carries.'
      : 'the board carries ' + money(row.implied_value_usd) + ', one dollar lower, so no two rows share a value.';
    dialog.appendChild(node('div', { cls: 'detail-head' },
      node('div', null,
        node('span', { cls: 'brand-name', txt: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · watchlist' : '') }),
        node('h2', { attrs: { id: 'detail-title' }, txt: row.name }),
        node('p', { cls: 'sub', txt: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · records no token' })
      ),
      node('button', { cls: 'close', attrs: { type: 'button', 'aria-label': 'Close details' }, txt: 'Close', on: { click: function () { dialog.close(); } } })
    ));
    dialog.appendChild(node('section', { cls: 'detail-section' },
      node('h3', { txt: 'Implied value' }),
      node('div', { cls: 'equation' },
        node('div', null, node('span', { txt: 'TVL' }), node('b', { cls: 'num', txt: money(row.tvl_usd) })),
        node('div', null, node('span', { txt: 'Seven-day growth' }), node('b', { cls: 'num', txt: pct(row.change_7d) })),
        node('div', null, node('span', { txt: 'Age with no token' }), node('b', { cls: 'num', txt: ageLabel(row.age_days) })),
        node('div', null, node('span', { txt: 'Chains' }), node('b', { cls: 'num', txt: String((row.chains || []).length) })),
        node('div', null, node('span', { txt: 'Size multiple' }), node('b', { cls: 'num', txt: String(row.size_multiple) })),
        node('div', null, node('span', { txt: 'Growth multiplier' }), node('b', { cls: 'num', txt: String(row.growth_multiplier) })),
        node('div', null, node('span', { txt: 'Maturity multiplier' }), node('b', { cls: 'num', txt: String(row.maturity_multiplier) })),
        node('div', null, node('span', { txt: 'Breadth multiplier' }), node('b', { cls: 'num', txt: String(row.breadth_multiplier) })),
        node('div', null, node('span', { txt: 'Implied value' }), node('b', { cls: 'num', txt: money(row.implied_value_usd) }))
      ),
      node('p', { cls: 'sub', txt: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recomputed) + ', ' + check + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(node('section', { cls: 'detail-section' },
      node('h3', { txt: 'Farm plan' }),
      node('ol', { cls: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return node('li', null, node('b', { txt: action }), node('span', { cls: 'cost', txt: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function renderAll() {
    mount.textContent = '';
    var shell = node('div', { cls: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    if (state.tab === 'pre-token') shell.appendChild(topThree());
    shell.appendChild(filters());
    shell.appendChild(state.tab === 'pre-token' ? boardPanel() : livePanel());
    if (state.tab === 'pre-token') shell.appendChild(formulaPanel());
    shell.appendChild(node('p', { cls: 'foot', txt: 'Data: DefiLlama protocol index, snapshot ' + DATA.as_of + '. "Records no token" means the snapshot carries no market cap, CoinGecko id or symbol for the protocol; it is not proof that no token exists. Implied values are this entry\'s own model, never a price and never a prediction that a token comes.' }));
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (state.selected) showDetail(state.selected);
  }

  readHash();
  renderAll();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
