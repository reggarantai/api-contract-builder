# Stock detail

Part of [Inventory App](../README.md).

## Description

_No description yet._

## Acceptance criteria

_None yet._

## Mockups

_No mockups yet._

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| When the page loads | `GET` | [`/stocks/{sku}`](#get-stockssku) | Get a stock item | Draft |

### GET /stocks/{sku}

Get a stock item

- **When:** When the page loads
- **Status:** Draft
- **Authentication:** bearerAuth (project default)

#### Parameters

| Name | In | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- | --- |
| `sku` | path | string | Yes | Stock keeping unit |  |

#### Responses

##### 200 OK

`application/json` — [Stock](../models.md#stock)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `sku` | string | Yes |  | pattern `^[A-Z0-9-]+$` |
| `name` | string | Yes |  | at most 120 characters |
| `quantity` | integer | Yes |  | ≥ 0 |
| `category` | [Category](../models.md#category) |  |  |  |
| `category.id` | string (uuid) | Yes |  |  |
| `category.name` | string | Yes |  |  |
| `category.parent` | [Category](../models.md#category) or null |  |  |  |
| `tags` | array of string |  |  | unique items |

Example `found`:

```json
{
  "sku": "SKU-001",
  "name": "Widget",
  "quantity": 12,
  "category": {
    "id": "6f1c2b9e-0b7a-4c64-9a8e-2f1d3c4b5a69",
    "name": "Parts",
    "parent": null
  },
  "tags": [
    "metal"
  ]
}
```

##### 404 Not Found

`application/json` — [Error](../models.md#error)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `message` | string | Yes |  |  |
| `code` | string |  |  |  |

Example `not-found`:

```json
{
  "message": "No item SKU-999"
}
```
