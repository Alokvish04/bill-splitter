# Shared Bill Splitter

A small app for splitting bills in a shared home. You create a home, add members, add a
bill, and the bill is split between all members. Each member pays their own share.

Built for the DoCoDeGo SDE intern assignment.

## Stack

- **API:** Hono on Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite)
- **Web:** React, Vite, TanStack Router
- **Language:** TypeScript on both sides, no `any`
- **Tests:** Vitest in the Workers runtime
- **Quality:** Biome (`pnpm check`) and `tsc` (`pnpm typecheck`)

## Run it

```
pnpm install
pnpm dev          # api on :8787, web on :5173
```

```
pnpm test         # API tests
pnpm check        # Biome format + lint
pnpm typecheck    # TypeScript on api and web
pnpm build        # production build of the web app
```

`pnpm dev` applies the migrations to a local database before the API starts.

## API

All amounts are whole cents. Every error is JSON: `{ "error": "message" }`.

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/api/homes` | Create a home |
| POST | `/api/homes/:homeId/members` | Add a member |
| POST | `/api/homes/:homeId/bills` | Create a bill and split it |
| GET | `/api/homes/:homeId/bills` | List the bills of a home with their shares |
| POST | `/api/bills/:billId/shares/:shareId/pay` | Pay a share (needs `Idempotency-Key` header) |
| GET | `/api/homes/:homeId/balances` | What each member still owes |

`GET /api/homes/:homeId/bills` is not in the assignment. I added it so the web page can
show the bills.

## Database

The schema is in `api/migrations/0001_init.sql`. These named constraints protect the data:

- `members_home_fk`, `bills_home_fk`, `shares_bill_fk`, `shares_member_fk`: a member,
  bill, or share can't point to a home, bill, or member that doesn't exist.
- `homes_name_not_blank`, `members_name_not_blank`: names can't be empty.
- `bills_total_positive`: a bill total must be greater than 0.
- `shares_amount_nonneg`: a share can't be negative.
- `shares_one_per_member`: a member gets only one share of a bill.

## How I handle the cases

1. **Home with no members:** creating a bill returns `422`.
2. **Zero, negative, or non-whole amount:** returns `422`. The check uses
   `Number.isSafeInteger` and `> 0`, and the database `CHECK` is a second guard.
3. **Amount that doesn't divide evenly:** the first `total % n` members get one extra cent.
4. **Same payment sent twice:** the share remembers its `Idempotency-Key`. The same key
   returns the same `200` and does not pay again.
5. **Two requests paying the same share at once:** only one can win, because the update
   only matches rows that are still unpaid. The other one gets `409`.
6. **Bill or share that doesn't exist:** `404`.
7. **API returns a 500 or is slow:** the API always answers with JSON errors. The web page
   uses a 10-second timeout, shows an error, and keeps the share unpaid.

## Decisions

1. **I store money as integer cents.** Decimal numbers can't store values like 0.10
   exactly, so I only use whole numbers. Each member gets `floor(total / n)`, and the
   first `total % n` members (in the order they joined) get 1 extra cent. So the shares
   always add up to the total. On the web page, I turn the typed amount into cents by
   reading the text, not by multiplying a decimal.

2. **Paying is one atomic `UPDATE ... WHERE paid_at IS NULL`.** I did not do "read the
   share, check it, then write", because two requests could both pass the check. With
   one update statement, only one request can change the row. The share also stores the
   key it was paid with, so a retry with the same key gets the same answer, and a
   different key gets `409`. The web page keeps one key per share until the payment
   succeeds, so retrying after a timeout is safe.

3. **A bill and its shares are saved together in one `db.batch`.** D1 runs a batch as a
   single transaction, so there is never a bill without its shares. I also put the rules
   in the database as named constraints, so bad data is rejected even if the API
   validation is skipped.

## Trade-offs

- I read the members first and insert the shares after. If someone is added in that tiny
  gap, they miss that bill. Creating the shares with one `INSERT ... SELECT` from the
  members table would fix it. I kept the simpler code because it is easier to read.
- The page shows a share as paid only after the API answers `200`. It is a little slower
  than updating right away, but a failed payment can never look paid.

## AI use

I used Claude (Anthropic) to plan the schema, the split and payment logic, and the web
page. I ran every check myself (`pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build`)
and tested the page in the browser, including stopping the API during a payment.