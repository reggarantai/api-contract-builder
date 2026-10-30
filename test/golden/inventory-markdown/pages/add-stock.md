# Add stock

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
| On form submit | `POST` | [`/stocks`](#post-stocks) | Add a stock item | In review |

### POST /stocks

Add a stock item

- **When:** On form submit
- **Status:** In review
- **Authentication:** bearerAuth (project default)

#### Request body

Required.

The new item

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

Example `new-item`:

```json
{
  "sku": "SKU-002",
  "name": "Gadget",
  "quantity": 0
}
```

#### Responses

##### 201 Created

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

Example `created`:

```json
{
  "sku": "SKU-002",
  "name": "Gadget",
  "quantity": 0
}
```

##### 409 Conflict

`application/json` — [Error](../models.md#error)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `message` | string | Yes |  |  |
| `code` | string |  |  |  |

Example `duplicate-sku`:

```json
{
  "message": "SKU-002 already exists"
}
```

**Notes for backend:** Reject duplicate SKUs with 409.
