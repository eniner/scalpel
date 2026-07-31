# Scalpel Advisor

Optional PoE1 overlay plugin (author **E9**) — farming EV tools hub inspired by Perandus Ledger.

## Tools

Gem Leveling, Gem Transfig, Beasts, Scarab Atlas, Essences, Harvest (Farming EV + Crop Rotation), Currency Trends, Boss Profitability, Nightmare Boss Rush, Betrayal EV, Scrying Orb.

## Develop / install

```bash
cd plugins/scalpel-advisor
npm install
npm test
npm run install:scalpel   # builds and copies to %APPDATA%\Scalpel\plugins\scalpel-advisor
```

Bind **Toggle Scalpel Advisor** in Settings → Macros. Prices use Scalpel’s `ctx.prices` (poe.ninja); some tools can refresh market snapshots from the public Ledger CDN when online.
