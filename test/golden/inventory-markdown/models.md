# Models

Shared data shapes the endpoints use. Part of [Inventory App](README.md).

## Category

A group of stock items.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `name` | string | Yes |  |  |
| `parent` | [Category](#category) or null |  |  |  |

## Error

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `message` | string | Yes |  |  |
| `code` | string |  |  |  |

## Stock

An item in stock.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `sku` | string | Yes |  | pattern `^[A-Z0-9-]+$` |
| `name` | string | Yes |  | at most 120 characters |
| `quantity` | integer | Yes |  | ≥ 0 |
| `category` | [Category](#category) |  |  |  |
| `tags` | array of string |  |  | unique items |
