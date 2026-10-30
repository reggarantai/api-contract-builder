# Add or edit stock item

Part of [Inventory App](../README.md).

## Description

One form for both: `/stock-items/new` adds an item and `/stock-items/{id}/edit` changes one. The quantity isn't on the form: new items start at 0, and movements change it.

## Acceptance criteria

- [ ] Each error in a 422 shows under the field its `pointer` names
- [ ] A 409 shows its `detail` under the field it's about: SKU or unit
- [ ] After saving, the user goes to the item's page

## Mockups

![Edit mode](../images/add-or-edit-stock-item/01-stock-item-form.png)

_Edit mode_

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| When the page loads — Category select | `GET` | [`/categories`](#get-categories) | List categories | Agreed |
| When the page loads — When editing | `GET` | [`/stock-items/{itemId}`](#get-stock-itemsitemid) | Get a stock item | Agreed |
| On form submit — When adding. One `Idempotency-Key` per form, until it saves | `POST` | [`/stock-items`](#post-stock-items) | Add a stock item | Agreed |
| On form submit — When editing. Only the changed fields | `PATCH` | [`/stock-items/{itemId}`](#patch-stock-itemsitemid) | Update a stock item | Agreed |

### GET /categories

List categories

- **When:** When the page loads — Category select
- **Status:** Agreed
- **Authentication:** bearerAuth (project default)

All categories, by name. There are few, so there are no pages.

#### Responses

##### 200 OK

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `data` | array of [Category](../models.md#category) | Yes |  |  |
| `data[].id` | string (uuid) | Yes |  |  |
| `data[].name` | string | Yes |  | 1–60 characters |

Example `three`:

```json
{
  "data": [
    {
      "id": "c8e2a4b6-3d5f-4a7c-9e1b-2f4d6a8c0e3b",
      "name": "Cleaning supplies"
    },
    {
      "id": "6f1c2b9e-0b7a-4c64-9a8e-2f1d3c4b5a69",
      "name": "Packaging"
    },
    {
      "id": "a3d5f7b9-1c2e-4f6a-8b0d-9e7c5a3b1d2f",
      "name": "Spare parts"
    }
  ]
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

### GET /stock-items/{itemId}

Get a stock item

- **When:** When the page loads — When editing
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

### POST /stock-items

Add a stock item

- **When:** On form submit — When adding. One `Idempotency-Key` per form, until it saves
- **Status:** Agreed
- **Authentication:** bearerAuth (project default)

The new item starts with 0 on hand. The response holds the item, and `Location` its URL.

#### Parameters

| Name | In | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `Idempotency-Key` | header | string | Yes | A random value, like a UUID, for each thing to create. Resending with the same key gets the first success back (for 24 hours) instead of creating again. Failures aren't remembered, so a fixed request can reuse the key. The key with a different body after a success answers 400; a resend while the first request runs answers 409 `request-in-progress`. | 1–64 characters | `3f1d8a52-6b0e-4c1a-9d7e-2b4c6a8e0f13` |

#### Request body

Required.

`application/json` — [StockItemInput](../models.md#stockiteminput)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `sku` | string | Yes | Stock keeping unit: upper-case letters, digits, and hyphens. Unique among items that aren't deleted. | pattern `^[A-Z0-9-]{3,32}$` |
| `name` | string | Yes |  | 1–120 characters |
| `description` | string or null |  |  | at most 2000 characters |
| `categoryId` | string (uuid) | Yes |  |  |
| `unit` | string | Yes | What quantities count. It can't change once the item has stock movements. | one of `piece`, `box`, `roll`, `pack` |
| `reorderPoint` | integer |  | At or below this quantity, the item is low on stock | 0–1000000; default `0` |

Example `new-item`:

```json
{
  "sku": "LBL-100",
  "name": "Shipping labels, 100 × 150 mm",
  "description": null,
  "categoryId": "6f1c2b9e-0b7a-4c64-9a8e-2f1d3c4b5a69",
  "unit": "box",
  "reorderPoint": 5
}
```

#### Responses

##### 201 Created

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `Location` | string (uri-reference) | Yes | Where the new item lives |  | `/v1/stock-items/7d9f1b3d-5a8c-4f2a-8c6e-9b1d3f5a7c8e` |

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

Example `created`:

```json
{
  "id": "7d9f1b3d-5a8c-4f2a-8c6e-9b1d3f5a7c8e",
  "sku": "LBL-100",
  "name": "Shipping labels, 100 × 150 mm",
  "description": null,
  "category": {
    "id": "6f1c2b9e-0b7a-4c64-9a8e-2f1d3c4b5a69",
    "name": "Packaging"
  },
  "unit": "box",
  "quantityOnHand": 0,
  "reorderPoint": 5,
  "stockStatus": "out_of_stock",
  "createdAt": "2026-10-30T09:00:00Z",
  "updatedAt": "2026-10-30T09:00:00Z"
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

Example `sku-taken`:

```json
{
  "type": "https://api.inventory.example/problems/sku-taken",
  "title": "SKU already used",
  "status": 409,
  "detail": "TAPE-050 is already used by Packing tape, 50 m."
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

Example `unknown-category`:

```json
{
  "type": "https://api.inventory.example/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "Some fields are invalid.",
  "errors": [
    {
      "pointer": "#/categoryId",
      "detail": "There's no category with this ID."
    }
  ]
}
```

### PATCH /stock-items/{itemId}

Update a stock item

- **When:** On form submit — When editing. Only the changed fields
- **Status:** Agreed
- **Authentication:** bearerAuth (project default)

A JSON Merge Patch (RFC 7396): fields left out don't change, and `null` clears the description.

#### Parameters

| Name | In | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- | --- |
| `itemId` | path | string (uuid) | Yes | The stock item's ID. Unknown, malformed, and deleted IDs answer 404. |  |

#### Request body

Required.

`application/merge-patch+json` — [StockItemUpdate](../models.md#stockitemupdate)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `sku` | string |  | Stock keeping unit: upper-case letters, digits, and hyphens. Unique among items that aren't deleted. | pattern `^[A-Z0-9-]{3,32}$` |
| `name` | string |  |  | 1–120 characters |
| `description` | string or null |  |  | at most 2000 characters |
| `categoryId` | string (uuid) |  |  |  |
| `unit` | string |  | What quantities count. It can't change once the item has stock movements. | one of `piece`, `box`, `roll`, `pack` |
| `reorderPoint` | integer |  | At or below this quantity, the item is low on stock | 0–1000000 |

Example `reorder-point`:

```json
{
  "reorderPoint": 150
}
```

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

Example `updated`:

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
  "reorderPoint": 150,
  "stockStatus": "in_stock",
  "createdAt": "2026-09-14T08:30:00Z",
  "updatedAt": "2026-10-30T09:10:00Z"
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

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `sku-taken`:

```json
{
  "type": "https://api.inventory.example/problems/sku-taken",
  "title": "SKU already used",
  "status": 409,
  "detail": "TAPE-050 is already used by Packing tape, 50 m."
}
```

Example `unit-locked`:

```json
{
  "type": "https://api.inventory.example/problems/unit-locked",
  "title": "Unit can't change",
  "status": 409,
  "detail": "Shipping box, small already has stock movements, so its unit can't change."
}
```

##### 415 Unsupported Media Type

| Header | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `Accept-Patch` | string | Yes | The patch format this endpoint takes (RFC 5789) | always `application/merge-patch+json` |

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `not-merge-patch`:

```json
{
  "type": "https://api.inventory.example/problems/unsupported-media-type",
  "title": "Unsupported media type",
  "status": 415,
  "detail": "Send the changes as application/merge-patch+json."
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

Example `negative-reorder-point`:

```json
{
  "type": "https://api.inventory.example/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "Some fields are invalid.",
  "errors": [
    {
      "pointer": "#/reorderPoint",
      "detail": "Use 0 or more."
    }
  ]
}
```
