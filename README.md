# Conty Creator Attribution

Small API that ingests store-order webhooks, attributes each sale to at most one
creator through a single pure rule (**coupon beats UTM**), and tracks refunds as
append-only history. Money is integer cents (BRL, implicit); no floats anywhere.

## How to run

```bash
bun install
bun run dev     # API on http://localhost:3000 (PORT and DB_PATH env vars optional)
bun run test    # Vitest suite
bunx tsc --noEmit
```

## Endpoints

### `GET /health`

`200` → `{ "status": "ok" }`

### `POST /creators` — register a creator

Request: `{ "name": string, "couponCode": string, "utmCampaign": string }`

- `201` → created creator `{ "id", "name", "couponCode", "utmCampaign" }`
- `400` → schema violation, with `details`
- `409` → `couponCode` or `utmCampaign` already in use

### `GET /creators`

`200` → `{ "creators": [...] }` (includes seed creators Ana/Bruno).

### `POST /orders` — order webhook (idempotent, first write wins)

Request:

```json
{ "id": "ord-1", "totalCents": 1999, "coupon": "ANA10", "utmSource": "shop", "utmCampaign": "ana-summer", "status": "paid" }
```

Only `id` and `totalCents` (positive integer) are required; the rest are optional.
`status` is stored raw and never drives attribution. A resend of the same `id`
— even with divergent payload — returns `200` with the original record; nothing
is re-counted or re-attributed.

- `201` → created; `200` → duplicate (original returned unchanged)
- `400` → schema violation (zero/negative/non-integer `totalCents`), with `details`

Creating an order also applies that order's `pending` refunds in arrival order,
inside the same transaction, respecting the cap (see refunds).

### `GET /orders/:id` — read an order

`200` →

```json
{
  "id": "ord-1", "totalCents": 1999, "coupon": "ANA10",
  "utmSource": "shop", "utmCampaign": "ana-summer", "storeStatus": "paid",
  "creatorId": 1, "creator": { "id": 1, "name": "Ana", "couponCode": "ANA10", "utmCampaign": "ana-summer" },
  "refunds": [{ "id": "ref-1", "orderId": "ord-1", "amountCents": 500, "status": "applied", "reason": null }],
  "netTotalCents": 1499,
  "attributionStatus": "attributed"
}
```

`netTotalCents` is derived (`totalCents` minus applied refunds), never stored.
`404` → `{ "error": "order not found" }`.

### `POST /refunds` — refund webhook (idempotent, first write wins)

Request: `{ "id": "ref-1", "orderId": "ord-1", "amountCents": 500 }`
(`amountCents` must be a positive integer.)

- Order known, within cap → `201`, refund stored as `applied`.
- Order unknown (early refund) → `201`, refund stored as `pending`; it applies
  in arrival order when the order later arrives. A pending that would breach the
  cap becomes `rejected` with reason `exceeds-total`. Early refunds are never lost.
- Over-cap on a known order → `422` with `{ "error", "reason": "exceeds-total", "refund" }`;
  the refund is stored as `rejected` (visible, excluded from the sum), never silently clamped.
- Repeated `id` (even with a different amount) → `200` with the original refund; no double-count.
- `400` → schema violation (zero/negative/non-integer `amountCents`), with `details`.

### `GET /refunds?orderId=ord-1` — refund listing

`200` → `{ "orderId": "ord-1", "refunds": [...] }` with every state (`applied`,
`pending`, `rejected`), in arrival order — including `pending` refunds for an
order id that does not exist yet, so early refunds stay traceable at any time.
`400` → missing `orderId` query parameter.

## Attribution rule (tie-break)

One pure resolver, one place: a coupon match wins over a UTM-campaign match; no
recognizable match yields `unattributed` (never guessed). Normalization: coupon
is trimmed and uppercased, UTM campaign is trimmed and lowercased, then matched
exactly against the creator registry. Each creator holds a unique coupon code
and a unique UTM campaign.

## Attribution status

`unattributed` | `attributed` | `reversed`. `reversed` is derived at read time
— cumulative applied refunds equal the order total (one full refund or several
partials summing to it). Reversal preserves the creator reference and the full
refund history; the store-provided order status never drives attribution, only
refunds move status. Cap invariant: the sum of applied refunds never exceeds the
order total.

## Assumptions

- **Stable refund ids:** senders keep the refund `id` stable across retries, so
  repeats are detected as duplicates. The cap bounds the damage of a regenerated
  id (worst case: one extra `rejected` record, totals stay correct).

## AI assistance declaration

- AI-assisted: API implementation, tests, and this README were drafted with an
  AI coding assistant.
- Human-reviewed: the final diff, the full test suite (`bun run test`), and the
  type check (`bunx tsc --noEmit`) were reviewed and verified by a human before
  submission.
