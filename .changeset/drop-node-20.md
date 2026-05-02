---
"hono-idempotency": minor
---

Drop Node.js 20 support. Minimum supported Node.js version is now 22.

Node.js 20 reached end-of-life on 2026-04-30. CI is now tested on Node 22 and 24 only, and `package.json` declares `engines.node: ">=22"`. The published bundle does not use any 22-only Node APIs, but the supported range now reflects what is actually tested.

Users on Node 20 should upgrade to Node 22 (the current LTS).
