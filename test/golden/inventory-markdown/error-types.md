# Error types

The errors endpoints answer, each described once. Part of [Inventory App](README.md).

## idempotency-key-missing

**400** — Idempotency-Key missing

A create was sent without an `Idempotency-Key` header.

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/idempotency-key-missing",
  "title": "Idempotency-Key missing",
  "status": 400,
  "detail": "Send an Idempotency-Key header with each create."
}
```

Returned by [`POST /stock-items`](pages/add-or-edit-stock-item.md#post-stock-items), [`POST /stock-items/{itemId}/movements`](pages/stock-item.md#post-stock-itemsitemidmovements).

## idempotency-key-reused

**400** — Idempotency-Key reused

The key was already used for a request with a different body. Make a new key for each new thing to create.

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/idempotency-key-reused",
  "title": "Idempotency-Key reused",
  "status": 400,
  "detail": "This key was already used for a different request. Make a new one."
}
```

Returned by [`POST /stock-items`](pages/add-or-edit-stock-item.md#post-stock-items), [`POST /stock-items/{itemId}/movements`](pages/stock-item.md#post-stock-itemsitemidmovements).

## invalid-credentials

**400** — Invalid credentials

The email or password is wrong. It's 400, not 401: a 401 always means the access token is missing or expired.

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/invalid-credentials",
  "title": "Invalid credentials",
  "status": 400,
  "detail": "Email or password is wrong."
}
```

Returned by [`POST /auth/login`](pages/login.md#post-authlogin).

## invalid-link

**400** — Invalid or expired link

The token from an email link is unknown or has expired. Offer to send a new link.

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/invalid-link",
  "title": "Invalid or expired link",
  "status": 400,
  "detail": "This link is invalid or has expired. Ask for a new one."
}
```

Returned by [`POST /auth/reset-password`](pages/reset-password.md#post-authreset-password), [`POST /auth/verify-email`](pages/verify-email.md#post-authverify-email).

## invalid-parameters

**400** — Invalid parameters

A query or header parameter is invalid; `detail` says which.

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/invalid-parameters",
  "title": "Invalid parameters",
  "status": 400,
  "detail": "pageSize must be between 1 and 100."
}
```

Returned by [`GET /stock-items`](pages/stock-list.md#get-stock-items), [`GET /stock-items/{itemId}/movements`](pages/stock-item.md#get-stock-itemsitemidmovements).

## session-expired

**401** — Session expired

The refresh token is missing, expired, or revoked, so the session is over. Sign in again.

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `Set-Cookie` | string | Yes | Clears the refresh token cookie |  | `refresh_token=; HttpOnly; Secure; SameSite=Strict; Path=/v1/auth; Max-Age=0` |

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/session-expired",
  "title": "Session expired",
  "status": 401,
  "detail": "Sign in again."
}
```

Returned by [`POST /auth/refresh`](pages/app-shell.md#post-authrefresh).

## token-expired

**401** — Access token expired

The access token has expired. Refresh it once with `POST /auth/refresh`, then retry the request.

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `WWW-Authenticate` | string | Yes | The Bearer challenge (RFC 6750). It adds `error="invalid_token"` when the token sent is expired or invalid. |  | `Bearer realm="inventory", error="invalid_token", error_description="The access token expired"` |

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/token-expired",
  "title": "Access token expired",
  "status": 401,
  "detail": "Refresh the access token and try again."
}
```

Returned by [`GET /categories`](pages/stock-list.md#get-categories), [`GET /me`](pages/app-shell.md#get-me), [`GET /stock-items`](pages/stock-list.md#get-stock-items), [`POST /stock-items`](pages/add-or-edit-stock-item.md#post-stock-items), [`GET /stock-items/{itemId}`](pages/stock-item.md#get-stock-itemsitemid), [`PATCH /stock-items/{itemId}`](pages/add-or-edit-stock-item.md#patch-stock-itemsitemid), [`DELETE /stock-items/{itemId}`](pages/stock-list.md#delete-stock-itemsitemid), [`GET /stock-items/{itemId}/movements`](pages/stock-item.md#get-stock-itemsitemidmovements), [`POST /stock-items/{itemId}/movements`](pages/stock-item.md#post-stock-itemsitemidmovements).

## unauthenticated

**401** — Not signed in

The request has no access token. Send one in the `Authorization` header.

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `WWW-Authenticate` | string | Yes | The Bearer challenge (RFC 6750). It adds `error="invalid_token"` when the token sent is expired or invalid. |  | `Bearer realm="inventory"` |

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/unauthenticated",
  "title": "Not signed in",
  "status": 401,
  "detail": "Send an access token in the Authorization header."
}
```

Returned by [`GET /categories`](pages/stock-list.md#get-categories), [`GET /me`](pages/app-shell.md#get-me), [`GET /stock-items`](pages/stock-list.md#get-stock-items), [`POST /stock-items`](pages/add-or-edit-stock-item.md#post-stock-items), [`GET /stock-items/{itemId}`](pages/stock-item.md#get-stock-itemsitemid), [`PATCH /stock-items/{itemId}`](pages/add-or-edit-stock-item.md#patch-stock-itemsitemid), [`DELETE /stock-items/{itemId}`](pages/stock-list.md#delete-stock-itemsitemid), [`GET /stock-items/{itemId}/movements`](pages/stock-item.md#get-stock-itemsitemidmovements), [`POST /stock-items/{itemId}/movements`](pages/stock-item.md#post-stock-itemsitemidmovements).

## admins-only

**403** — Admins only

Only admins can do this; staff can't.

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/admins-only",
  "title": "Admins only",
  "status": 403,
  "detail": "Only admins can delete stock items."
}
```

Returned by [`DELETE /stock-items/{itemId}`](pages/stock-list.md#delete-stock-itemsitemid).

## email-not-verified

**403** — Email not verified

The password matched, but the email address isn't verified yet. Offer to send a new link with `POST /auth/verify-email/resend`.

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/email-not-verified",
  "title": "Email not verified",
  "status": 403,
  "detail": "Verify your email address first. We sent a link to budi@example.com."
}
```

Returned by [`POST /auth/login`](pages/login.md#post-authlogin).

## not-found

**404** — Not found

Nothing has this ID: it's unknown, malformed, or deleted.

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/not-found",
  "title": "Not found",
  "status": 404,
  "detail": "There's no stock item with ID 9d0c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a."
}
```

Returned by [`GET /stock-items/{itemId}`](pages/stock-item.md#get-stock-itemsitemid), [`PATCH /stock-items/{itemId}`](pages/add-or-edit-stock-item.md#patch-stock-itemsitemid), [`DELETE /stock-items/{itemId}`](pages/stock-list.md#delete-stock-itemsitemid), [`GET /stock-items/{itemId}/movements`](pages/stock-item.md#get-stock-itemsitemidmovements), [`POST /stock-items/{itemId}/movements`](pages/stock-item.md#post-stock-itemsitemidmovements).

## insufficient-stock

**409** — Not enough stock

The issue would take the quantity on hand below 0. Nothing was recorded.

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/insufficient-stock",
  "title": "Not enough stock",
  "status": 409,
  "detail": "Only 18 on hand, so 30 can't be issued."
}
```

Returned by [`POST /stock-items/{itemId}/movements`](pages/stock-item.md#post-stock-itemsitemidmovements).

## item-has-stock

**409** — Item still in stock

Only items with nothing on hand can be deleted. Issue or count the stock to 0 first.

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/item-has-stock",
  "title": "Item still in stock",
  "status": 409,
  "detail": "Shipping box, small still has 340 on hand. Issue or count them to 0 first."
}
```

Returned by [`DELETE /stock-items/{itemId}`](pages/stock-list.md#delete-stock-itemsitemid).

## request-in-progress

**409** — Request in progress

A request with the same `Idempotency-Key` is still running. Resend it after `Retry-After` seconds to get its result.

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `Retry-After` | integer | Yes | Seconds before resending | ≥ 1 | `2` |

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/request-in-progress",
  "title": "Request in progress",
  "status": 409,
  "detail": "A request with this Idempotency-Key is still running. Resend it later."
}
```

Returned by [`POST /stock-items`](pages/add-or-edit-stock-item.md#post-stock-items), [`POST /stock-items/{itemId}/movements`](pages/stock-item.md#post-stock-itemsitemidmovements).

## sku-taken

**409** — SKU already used

Another stock item has this SKU. SKUs are unique, ignoring case; a deleted item's SKU can be used again.

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/sku-taken",
  "title": "SKU already used",
  "status": 409,
  "detail": "TAPE-050 is already used by Packing tape, 50 m."
}
```

Returned by [`POST /stock-items`](pages/add-or-edit-stock-item.md#post-stock-items), [`PATCH /stock-items/{itemId}`](pages/add-or-edit-stock-item.md#patch-stock-itemsitemid).

## unit-locked

**409** — Unit can't change

The item already has stock movements, so its unit can't change.

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/unit-locked",
  "title": "Unit can't change",
  "status": 409,
  "detail": "Shipping box, small already has stock movements, so its unit can't change."
}
```

Returned by [`PATCH /stock-items/{itemId}`](pages/add-or-edit-stock-item.md#patch-stock-itemsitemid).

## unsupported-media-type

**415** — Unsupported media type

The request body isn't in a content type the endpoint takes.

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/unsupported-media-type",
  "title": "Unsupported media type",
  "status": 415,
  "detail": "Send the body as JSON."
}
```

Returned by [`PATCH /stock-items/{itemId}`](pages/add-or-edit-stock-item.md#patch-stock-itemsitemid).

## validation-failed

**422** — Validation failed

Some fields of the request body are invalid. `errors` lists each one, with a JSON Pointer to the field, so a form can show each message next to its field.

`application/problem+json` — [ValidationProblem](models.md#validationproblem)

```json
{
  "type": "https://api.inventory.example/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "Some fields are invalid.",
  "errors": [
    {
      "pointer": "#/name",
      "detail": "Enter a name."
    }
  ]
}
```

Returned by [`POST /auth/forgot-password`](pages/forgot-password.md#post-authforgot-password), [`POST /auth/login`](pages/login.md#post-authlogin), [`POST /auth/register`](pages/registration.md#post-authregister), [`POST /auth/reset-password`](pages/reset-password.md#post-authreset-password), [`POST /auth/verify-email`](pages/verify-email.md#post-authverify-email), [`POST /auth/verify-email/resend`](pages/login.md#post-authverify-emailresend), [`POST /stock-items`](pages/add-or-edit-stock-item.md#post-stock-items), [`PATCH /stock-items/{itemId}`](pages/add-or-edit-stock-item.md#patch-stock-itemsitemid), [`POST /stock-items/{itemId}/movements`](pages/stock-item.md#post-stock-itemsitemidmovements).

## too-many-attempts

**429** — Too many attempts

Too many failed sign-ins for this email or from this IP address. Wait `Retry-After` seconds.

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `Retry-After` | integer | Yes | Seconds to wait before trying again | ≥ 1 | `900` |

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/too-many-attempts",
  "title": "Too many attempts",
  "status": 429,
  "detail": "Too many sign-in attempts. Try again in 15 minutes."
}
```

Returned by [`POST /auth/login`](pages/login.md#post-authlogin).

## too-many-requests

**429** — Too many requests

Too many emails were asked for in a short time. Wait `Retry-After` seconds.

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `Retry-After` | integer | Yes | Seconds to wait before trying again | ≥ 1 | `60` |

`application/problem+json` — [Problem](models.md#problem)

```json
{
  "type": "https://api.inventory.example/problems/too-many-requests",
  "title": "Too many requests",
  "status": 429,
  "detail": "Wait a minute before asking for another email."
}
```

Returned by [`POST /auth/forgot-password`](pages/forgot-password.md#post-authforgot-password), [`POST /auth/register`](pages/registration.md#post-authregister), [`POST /auth/verify-email/resend`](pages/login.md#post-authverify-emailresend).
