# Stock list

Part of [Inventory App](../README.md).

## Description

All stock items, with search, filters, and pages. Items low on stock or out of stock stand out.

## Acceptance criteria

- [ ] Search, filters, sort, and page are kept in the URL, so a filtered list can be shared
- [ ] Low stock shows an amber badge, out of stock a red one
- [ ] Only admins see Delete, and it asks for confirmation first
- [ ] A 409 when deleting shows the `detail` from the API

## Mockups

![Items low on stock and out of stock stand out](../images/stock-list/01-stock-list.png)

_Items low on stock and out of stock stand out_

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| When the page loads — Again when search, filters, sort, or page change, and after a delete | `GET` | [`/stock-items`](#get-stock-items) | List stock items | Agreed |
| When the page loads — Category filter | `GET` | [`/categories`](#get-categories) | List categories | Agreed |
| On a user action — Delete in a row's menu, for admins | `DELETE` | [`/stock-items/{itemId}`](#delete-stock-itemsitemid) | Delete a stock item | In review |

### GET /stock-items

List stock items

- **When:** When the page loads — Again when search, filters, sort, or page change, and after a delete
- **Status:** Agreed
- **Authentication:** bearerAuth (project default)

#### Parameters

| Name | In | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- | --- |
| `q` | query | string |  | Matches the SKU or name, ignoring case | at most 100 characters |
| `categoryId` | query | string (uuid) |  | Only items in this category. An unknown ID gives an empty list. |  |
| `stockStatus` | query | string |  | Only items with this stock status | one of `in_stock`, `low_stock`, `out_of_stock` |
| `sort` | query | string |  | Sort by this field; a leading `-` sorts descending. Ties are broken by `id`, so pages don't overlap. | one of `name`, `-name`, `sku`, `-sku`, `quantityOnHand`, `-quantityOnHand`, `updatedAt`, `-updatedAt`; default `name` |
| `page` | query | integer |  | Page number, from 1 | ≥ 1; default `1` |
| `pageSize` | query | integer |  | Items per page | 1–100; default `20` |

#### Responses

##### 200 OK

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `data` | array of [StockItem](../models.md#stockitem) | Yes |  |  |
| `data[].id` | string (uuid) | Yes |  |  |
| `data[].sku` | string | Yes | Stock keeping unit: upper-case letters, digits, and hyphens. Unique among items that aren't deleted. | pattern `^[A-Z0-9-]{3,32}$` |
| `data[].name` | string | Yes |  | 1–120 characters |
| `data[].description` | string or null | Yes |  | at most 2000 characters |
| `data[].category` | [Category](../models.md#category) | Yes |  |  |
| `data[].category.id` | string (uuid) | Yes |  |  |
| `data[].category.name` | string | Yes |  | 1–60 characters |
| `data[].unit` | string | Yes | What quantities count. It can't change once the item has stock movements. | one of `piece`, `box`, `roll`, `pack` |
| `data[].quantityOnHand` | integer | Yes |  | ≥ 0 |
| `data[].reorderPoint` | integer | Yes | At or below this quantity, the item is low on stock | 0–1000000 |
| `data[].stockStatus` | string | Yes | `out_of_stock` at 0; `low_stock` at or below `reorderPoint` | one of `in_stock`, `low_stock`, `out_of_stock` |
| `data[].createdAt` | string (date-time) | Yes |  |  |
| `data[].updatedAt` | string (date-time) | Yes |  |  |
| `meta` | [PageMeta](../models.md#pagemeta) | Yes |  |  |
| `meta.page` | integer | Yes | The page number | ≥ 1 |
| `meta.pageSize` | integer | Yes | Items per page | 1–100 |
| `meta.totalItems` | integer | Yes | Items in the whole list | ≥ 0 |
| `meta.totalPages` | integer | Yes | 0 when the list is empty | ≥ 0 |

Example `first-page` — Three items:

```json
{
  "data": [
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
    },
    {
      "id": "2f4b6d8f-0c3e-4a7b-9d1f-4c6e8a0b2d3f",
      "sku": "TAPE-050",
      "name": "Packing tape, 50 m",
      "description": null,
      "category": {
        "id": "6f1c2b9e-0b7a-4c64-9a8e-2f1d3c4b5a69",
        "name": "Packaging"
      },
      "unit": "roll",
      "quantityOnHand": 18,
      "reorderPoint": 24,
      "stockStatus": "low_stock",
      "createdAt": "2026-09-14T08:34:00Z",
      "updatedAt": "2026-10-29T10:20:00Z"
    },
    {
      "id": "3a5c7e9a-1d4f-4b8c-8e2a-5d7f9b1c3e4a",
      "sku": "FILM-500",
      "name": "Stretch film, 500 mm",
      "description": "23 µm, for wrapping pallets by hand",
      "category": {
        "id": "6f1c2b9e-0b7a-4c64-9a8e-2f1d3c4b5a69",
        "name": "Packaging"
      },
      "unit": "roll",
      "quantityOnHand": 0,
      "reorderPoint": 10,
      "stockStatus": "out_of_stock",
      "createdAt": "2026-09-20T13:00:00Z",
      "updatedAt": "2026-10-27T17:45:00Z"
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

Example `empty` — Nothing matches:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 0,
    "totalPages": 0
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

### GET /categories

List categories

- **When:** When the page loads — Category filter
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

### DELETE /stock-items/{itemId}

Delete a stock item

- **When:** On a user action — Delete in a row's menu, for admins
- **Status:** In review
- **Authentication:** bearerAuth (project default)

For admins. Only items with nothing on hand can be deleted. Deleted items answer 404 everywhere and leave lists, and their SKU can be used again.

#### Parameters

| Name | In | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- | --- |
| `itemId` | path | string (uuid) | Yes | The stock item's ID. Unknown, malformed, and deleted IDs answer 404. |  |

#### Responses

##### 204 No Content

No body.

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

##### 403 Forbidden

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `admins-only`:

```json
{
  "type": "https://api.inventory.example/problems/admins-only",
  "title": "Admins only",
  "status": 403,
  "detail": "Only admins can delete stock items."
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

Example `has-stock`:

```json
{
  "type": "https://api.inventory.example/problems/item-has-stock",
  "title": "Item still in stock",
  "status": 409,
  "detail": "Shipping box, small still has 340 on hand. Issue or count them to 0 first."
}
```

**Notes for backend:** Soft delete: keep the item and its movements for reports.
