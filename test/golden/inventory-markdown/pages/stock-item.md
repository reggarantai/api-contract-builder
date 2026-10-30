# Stock item

Part of [Inventory App](../README.md).

## Description

One item, with its movement history. The warehouse records deliveries, issues, and stock counts here.

## Acceptance criteria

- [ ] The quantity on hand and stock status update right after a movement is recorded
- [ ] Issuing more than is on hand shows the API's `detail` in the dialog
- [ ] The history shows the newest movement first, 20 per page
- [ ] Saving twice (e.g. a double click) records the movement once: both requests send the same `Idempotency-Key`

## Mockups

![Details and movement history](../images/stock-item/01-stock-item.png)

_Details and movement history_

![Record movement dialog](../images/stock-item/02-record-movement.png)

_Record movement dialog_

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| When the page loads — Again after a movement is recorded, for the new quantity and stock status | `GET` | [`/stock-items/{itemId}`](#get-stock-itemsitemid) | Get a stock item | Agreed |
| When the page loads — Again after a movement is recorded | `GET` | [`/stock-items/{itemId}/movements`](#get-stock-itemsitemidmovements) | List an item's stock movements | Agreed |
| On form submit — Record movement dialog. One `Idempotency-Key` per dialog, until it saves | `POST` | [`/stock-items/{itemId}/movements`](#post-stock-itemsitemidmovements) | Record a stock movement | In review |

### GET /stock-items/{itemId}

Get a stock item

- **When:** When the page loads — Again after a movement is recorded, for the new quantity and stock status
- **Status:** Agreed
- **Authentication:** bearerAuth (project default)

#### Parameters

| Name | In | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- | --- |
| `itemId` | path | string (uuid) | Yes | The stock item's ID. Unknown, malformed, and deleted IDs answer 404. |  |

#### Responses

##### 200 OK

`application/json` — [StockItem](../models.md#stockitem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `sku` | string | Yes | Stock keeping unit: upper-case letters, digits, and hyphens. Unique among items that aren't deleted. | pattern `^[A-Z0-9-]{3,32}$` |
| `name` | string | Yes |  | 1–120 characters |
| `description` | string or null | Yes |  | at most 2000 characters |
| `category` | [Category](../models.md#category) | Yes |  |  |
| `category.id` | string (uuid) | Yes |  |  |
| `category.name` | string | Yes |  | 1–60 characters |
| `unit` | string | Yes | What quantities count. It can't change once the item has stock movements. | one of `piece`, `box`, `roll`, `pack` |
| `quantityOnHand` | integer | Yes |  | ≥ 0 |
| `reorderPoint` | integer | Yes | At or below this quantity, the item is low on stock | 0–1000000 |
| `stockStatus` | string | Yes | `out_of_stock` at 0; `low_stock` at or below `reorderPoint` | one of `in_stock`, `low_stock`, `out_of_stock` |
| `createdAt` | string (date-time) | Yes |  |  |
| `updatedAt` | string (date-time) | Yes |  |  |

Example `box`:

```json
{
  "id": "1e3a5c7e-9b2d-4f6a-8c0e-3b5d7f9a1c2e",
  "sku": "BOX-S-001",
  "name": "Shipping box, small",
  "description": "Single wall, 30 × 20 × 15 cm",
  "category": {
    "id": "6f1c2b9e-0b7a-4c64-9a8e-2f1d3c4b5a69",
    "name": "Packaging"
  },
  "unit": "piece",
  "quantityOnHand": 340,
  "reorderPoint": 100,
  "stockStatus": "in_stock",
  "createdAt": "2026-09-14T08:30:00Z",
  "updatedAt": "2026-10-28T14:05:00Z"
}
```

##### 401 Unauthorized

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `WWW-Authenticate` | string | Yes | The Bearer challenge (RFC 6750). It adds `error="invalid_token"` when the token sent is expired or invalid. |  | `Bearer realm="inventory", error="invalid_token", error_description="The access token expired"` |

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `token-expired`:

```json
{
  "type": "https://api.inventory.example/problems/token-expired",
  "title": "Access token expired",
  "status": 401,
  "detail": "Refresh the access token and try again."
}
```

Example `unauthenticated`:

```json
{
  "type": "https://api.inventory.example/problems/unauthenticated",
  "title": "Not signed in",
  "status": 401,
  "detail": "Send an access token in the Authorization header."
}
```

##### 404 Not Found

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `not-found`:

```json
{
  "type": "https://api.inventory.example/problems/not-found",
  "title": "Not found",
  "status": 404,
  "detail": "There's no stock item with ID 9d0c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a."
}
```

### GET /stock-items/{itemId}/movements

List an item's stock movements

- **When:** When the page loads — Again after a movement is recorded
- **Status:** Agreed
- **Authentication:** bearerAuth (project default)

Newest first.

#### Parameters

| Name | In | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- | --- |
| `itemId` | path | string (uuid) | Yes | The stock item's ID. Unknown, malformed, and deleted IDs answer 404. |  |
| `page` | query | integer |  | Page number, from 1 | ≥ 1; default `1` |
| `pageSize` | query | integer |  | Items per page | 1–100; default `20` |

#### Responses

##### 200 OK

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `data` | array of [StockMovement](../models.md#stockmovement) | Yes |  |  |
| `data[].id` | string (uuid) | Yes |  |  |
| `data[].type` | string | Yes | `receipt` adds stock, `issue` takes it out, `count` sets it to what was counted | one of `receipt`, `issue`, `count` |
| `data[].quantity` | integer | Yes | As entered: the amount received or issued, or the counted quantity | ≥ 0 |
| `data[].quantityChange` | integer | Yes | How the quantity on hand changed: positive or negative |  |
| `data[].quantityAfter` | integer | Yes | Quantity on hand after this movement | ≥ 0 |
| `data[].reference` | string or null | Yes | Delivery note, order, or ticket number | at most 64 characters |
| `data[].note` | string or null | Yes |  | at most 500 characters |
| `data[].createdBy` | object | Yes | Who recorded it |  |
| `data[].createdBy.id` | string (uuid) | Yes |  |  |
| `data[].createdBy.name` | string | Yes |  |  |
| `data[].createdAt` | string (date-time) | Yes |  |  |
| `meta` | [PageMeta](../models.md#pagemeta) | Yes |  |  |
| `meta.page` | integer | Yes | The page number | ≥ 1 |
| `meta.pageSize` | integer | Yes | Items per page | 1–100 |
| `meta.totalItems` | integer | Yes | Items in the whole list | ≥ 0 |
| `meta.totalPages` | integer | Yes | 0 when the list is empty | ≥ 0 |

Example `history`:

```json
{
  "data": [
    {
      "id": "4b6d8f0b-2e5a-4c9d-9f3b-6e8a0c2d4f5b",
      "type": "receipt",
      "quantity": 200,
      "quantityChange": 200,
      "quantityAfter": 340,
      "reference": "DN-2026-1042",
      "note": null,
      "createdBy": {
        "id": "0b5c2d4e-8f1a-4b3c-9d2e-7a6f5e4d3c2b",
        "name": "Ana Lima"
      },
      "createdAt": "2026-10-28T14:05:00Z"
    },
    {
      "id": "5c7e9a1c-3f6b-4d0e-8a4c-7f9b1d3e5a6c",
      "type": "issue",
      "quantity": 25,
      "quantityChange": -25,
      "quantityAfter": 140,
      "reference": "SO-88213",
      "note": null,
      "createdBy": {
        "id": "0b5c2d4e-8f1a-4b3c-9d2e-7a6f5e4d3c2b",
        "name": "Ana Lima"
      },
      "createdAt": "2026-10-15T11:30:00Z"
    },
    {
      "id": "6d8f0b2d-4a7c-4e1f-9b5d-8a0c2e4f6b7d",
      "type": "count",
      "quantity": 165,
      "quantityChange": -3,
      "quantityAfter": 165,
      "reference": null,
      "note": "Monthly stock take",
      "createdBy": {
        "id": "0b5c2d4e-8f1a-4b3c-9d2e-7a6f5e4d3c2b",
        "name": "Ana Lima"
      },
      "createdAt": "2026-10-01T16:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 3,
    "totalPages": 1
  }
}
```

##### 400 Bad Request

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `invalid-page-size`:

```json
{
  "type": "https://api.inventory.example/problems/invalid-parameters",
  "title": "Invalid parameters",
  "status": 400,
  "detail": "pageSize must be between 1 and 100."
}
```

##### 401 Unauthorized

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `WWW-Authenticate` | string | Yes | The Bearer challenge (RFC 6750). It adds `error="invalid_token"` when the token sent is expired or invalid. |  | `Bearer realm="inventory", error="invalid_token", error_description="The access token expired"` |

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `token-expired`:

```json
{
  "type": "https://api.inventory.example/problems/token-expired",
  "title": "Access token expired",
  "status": 401,
  "detail": "Refresh the access token and try again."
}
```

Example `unauthenticated`:

```json
{
  "type": "https://api.inventory.example/problems/unauthenticated",
  "title": "Not signed in",
  "status": 401,
  "detail": "Send an access token in the Authorization header."
}
```

##### 404 Not Found

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `not-found`:

```json
{
  "type": "https://api.inventory.example/problems/not-found",
  "title": "Not found",
  "status": 404,
  "detail": "There's no stock item with ID 9d0c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a."
}
```

### POST /stock-items/{itemId}/movements

Record a stock movement

- **When:** On form submit — Record movement dialog. One `Idempotency-Key` per dialog, until it saves
- **Status:** In review
- **Authentication:** bearerAuth (project default)

Changes the item's quantity on hand; `quantityAfter` is the new quantity. Fetch the item again for its new stock status.

#### Parameters

| Name | In | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `itemId` | path | string (uuid) | Yes | The stock item's ID. Unknown, malformed, and deleted IDs answer 404. |  |  |
| `Idempotency-Key` | header | string | Yes | A random value, like a UUID, for each thing to create. Resending with the same key gets the first success back (for 24 hours) instead of creating again. Failures aren't remembered, so a fixed request can reuse the key. The key with a different body after a success answers 400; a resend while the first request runs answers 409 `request-in-progress`. | 1–64 characters | `3f1d8a52-6b0e-4c1a-9d7e-2b4c6a8e0f13` |

#### Request body

Required.

`application/json` — [StockMovementInput](../models.md#stockmovementinput)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string | Yes | `receipt` adds stock, `issue` takes it out, `count` sets it to what was counted | one of `receipt`, `issue`, `count` |
| `quantity` | integer | Yes | At least 1 for receipts and issues | 0–1000000 |
| `reference` | string or null |  | Delivery note, order, or ticket number | at most 64 characters |
| `note` | string or null |  |  | at most 500 characters |

Example `receipt` — A delivery arrived:

```json
{
  "type": "receipt",
  "quantity": 200,
  "reference": "DN-2026-1042",
  "note": null
}
```

Example `issue` — Taken out for an order:

```json
{
  "type": "issue",
  "quantity": 25,
  "reference": "SO-88213",
  "note": null
}
```

Example `count` — Counted on the shelf:

```json
{
  "type": "count",
  "quantity": 165,
  "reference": null,
  "note": "Monthly stock take"
}
```

#### Responses

##### 201 Created

`application/json` — [StockMovement](../models.md#stockmovement)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `type` | string | Yes | `receipt` adds stock, `issue` takes it out, `count` sets it to what was counted | one of `receipt`, `issue`, `count` |
| `quantity` | integer | Yes | As entered: the amount received or issued, or the counted quantity | ≥ 0 |
| `quantityChange` | integer | Yes | How the quantity on hand changed: positive or negative |  |
| `quantityAfter` | integer | Yes | Quantity on hand after this movement | ≥ 0 |
| `reference` | string or null | Yes | Delivery note, order, or ticket number | at most 64 characters |
| `note` | string or null | Yes |  | at most 500 characters |
| `createdBy` | object | Yes | Who recorded it |  |
| `createdBy.id` | string (uuid) | Yes |  |  |
| `createdBy.name` | string | Yes |  |  |
| `createdAt` | string (date-time) | Yes |  |  |

Example `receipt`:

```json
{
  "id": "4b6d8f0b-2e5a-4c9d-9f3b-6e8a0c2d4f5b",
  "type": "receipt",
  "quantity": 200,
  "quantityChange": 200,
  "quantityAfter": 340,
  "reference": "DN-2026-1042",
  "note": null,
  "createdBy": {
    "id": "0b5c2d4e-8f1a-4b3c-9d2e-7a6f5e4d3c2b",
    "name": "Ana Lima"
  },
  "createdAt": "2026-10-28T14:05:00Z"
}
```

##### 400 Bad Request

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `missing-key`:

```json
{
  "type": "https://api.inventory.example/problems/idempotency-key-missing",
  "title": "Idempotency-Key missing",
  "status": 400,
  "detail": "Send an Idempotency-Key header with each create."
}
```

Example `key-reused`:

```json
{
  "type": "https://api.inventory.example/problems/idempotency-key-reused",
  "title": "Idempotency-Key reused",
  "status": 400,
  "detail": "This key was already used for a different request. Make a new one."
}
```

##### 401 Unauthorized

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `WWW-Authenticate` | string | Yes | The Bearer challenge (RFC 6750). It adds `error="invalid_token"` when the token sent is expired or invalid. |  | `Bearer realm="inventory", error="invalid_token", error_description="The access token expired"` |

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `token-expired`:

```json
{
  "type": "https://api.inventory.example/problems/token-expired",
  "title": "Access token expired",
  "status": 401,
  "detail": "Refresh the access token and try again."
}
```

Example `unauthenticated`:

```json
{
  "type": "https://api.inventory.example/problems/unauthenticated",
  "title": "Not signed in",
  "status": 401,
  "detail": "Send an access token in the Authorization header."
}
```

##### 404 Not Found

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `not-found`:

```json
{
  "type": "https://api.inventory.example/problems/not-found",
  "title": "Not found",
  "status": 404,
  "detail": "There's no stock item with ID 9d0c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a."
}
```

##### 409 Conflict

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `Retry-After` | integer |  | Only with `request-in-progress`: seconds before resending | ≥ 1 | `2` |

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `not-enough-stock`:

```json
{
  "type": "https://api.inventory.example/problems/insufficient-stock",
  "title": "Not enough stock",
  "status": 409,
  "detail": "Only 18 on hand, so 30 can't be issued."
}
```

Example `in-progress`:

```json
{
  "type": "https://api.inventory.example/problems/request-in-progress",
  "title": "Request in progress",
  "status": 409,
  "detail": "A request with this Idempotency-Key is still running. Resend it later."
}
```

##### 422 Unprocessable Content

`application/problem+json` — [ValidationProblem](../models.md#validationproblem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |
| `errors` | array of object | Yes | One entry per invalid field | at least 1 item |
| `errors[].pointer` | string | Yes | JSON Pointer (RFC 6901) to the field in the request body, as a URI fragment like `#/email` |  |
| `errors[].detail` | string | Yes | What's wrong with it |  |

Example `zero-receipt`:

```json
{
  "type": "https://api.inventory.example/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "Some fields are invalid.",
  "errors": [
    {
      "pointer": "#/quantity",
      "detail": "Receive at least 1."
    }
  ]
}
```

**Notes for backend:** Lock the item while recording, so two issues at the same time can't take the quantity below 0.
