# Customer App — Material Comparison Walkthrough

Written for whoever is demoing or QA-ing the customer side of material
comparison. Every step below was verified end-to-end against a copy of the
live dev data (Nashik, PIN 422001, vendors **OTG Trading LLP** and
**HANUMAN ELECTRICALS AND TRADERS**).

---

## Before you demo

The comparison feature is driven entirely by data. Three things must be true
or the screens will look empty — this is the usual cause of "it isn't
working":

| Requirement | Where to set it | How to check |
|---|---|---|
| Vendor is **active** and **approved** | Admin → Vendors | vendor row shows Active/Approved |
| Vendor has a **business pincode** (and ideally a pinned location) | Admin → Vendors → edit | `business.pincode` filled |
| Vendor stocks the material, **Available**, and (if vendor-added) **approved** | Admin → Vendors → Materials | no amber "Vendor • pending" badge |
| Vendor has an **OTG Rate** | Admin → Vendors → Materials → OTG Rate | blank = falls back to catalog price |

A material also needs a **Sub Category** if its category has any, otherwise
it cannot be reached from the sub-category filter chips in the app. The admin
form now enforces this.

---

## The flow

### 1. Customer sets a delivery site
`Home → location chip` (or `Settings → Manage addresses`) → **Add Address**.

Enter name/street/city and a **6-digit pincode**. GPS is optional — a site
can be added for a location the customer is not standing at. The pincode is
what drives everything below, so it is required.

### 2. Browse or search
`Home → search` or `Category → sub-category`.

Each result row now shows, for the customer's own delivery area:

```
Wonder Plus Cement
from ₹345/bag
2 suppliers near you · Delivers within 2 hours
```

- **from ₹345** is the cheapest supplier who can actually deliver there — not
  the master catalog price.
- If nobody serves that pincode the row reads **"No supplier in your area
  yet"** and shows the catalog price.

### 3. Open the product → Compare vendors
`Product detail → "Compare vendors near you"`.

The pincode is pre-filled from the customer's default site.

### 4. Compare, sort and filter
The comparison list shows, per vendor: **name · distance · delivery estimate
· price**.

Controls along the top:

| Chip | Effect |
|---|---|
| Recommended *(default)* | same-pincode vendors first, then nearest, then cheapest |
| Price: low to high / high to low | sort by price |
| Fastest delivery | sort by delivery ETA |
| Nearest | sort by distance |
| Within 2 hrs | show only vendors who can deliver within 2 hours |

Expected for Wonder Plus Cement @ 422001:

```
HANUMAN ELECTRICALS AND TRADERS   1.4 km   Delivers within 2 hours   ₹345
OTG Trading LLP                  40.5 km   Delivery time confirmed   ₹350
```

Only the **exact same material** ever appears here — the list is keyed on one
material id, so no alternatives or lookalikes are mixed in.

### 5. Pick a vendor
Tap a row. You return to the product page with a green
**"Sourcing from HANUMAN ELECTRICALS AND TRADERS · Delivers within 2 hours"**
pill, **and the price on the page changes to that vendor's price (₹345)**.

> This matters: the price shown is now the price that will actually be
> charged. Add to cart, checkout and the invoice all agree.

### 6. Browse the whole supplier (optional)
Tap **"View all materials from this supplier"** on any comparison row to open
that vendor's storefront — everything they stock, at their prices, with Add
to cart on each. Useful when a customer wants several items from one vendor.

### 7. Cart → Checkout → Order
Add to cart as normal. The chosen vendor travels with the line all the way
through checkout, and the order is placed **directly with that vendor** — it
is never silently reassigned.

The same material from two different vendors stays as **two separate cart
lines** at their two different prices.

### 8. After placing
- The selected vendor is notified immediately (in-app + push).
- Admin sees the order too.
- The customer's order shows under **Ongoing**, and the status updates as the
  vendor accepts → QC → packs → dispatches, with a plain-language line on the
  tracking screen at every stage.

---

## Quick API check (no app needed)

Useful when demoing without a device, or to prove the data is right before
blaming the UI. Replace the host with your environment.

```bash
# What a listing shows for a delivery area
curl "$API/mobile/catalog/materials?search=Wonder&pincode=422001" \
  | jq '.data[] | {name, supplierSummary}'

# The comparison list, cheapest first
curl "$API/mobile/catalog/materials/<materialId>/vendors?pincode=422001&sort=price_asc" \
  | jq '.data'

# Only vendors who can deliver within 2 hours
curl "$API/mobile/catalog/materials/<materialId>/vendors?pincode=422001&maxDeliveryHours=2" \
  | jq '.data'

# One supplier's full catalogue
curl "$API/mobile/catalog/vendors/<vendorId>" | jq '.data'
```

---

## If a vendor doesn't appear

Work down this list — it is ordered by how often each one is the cause:

1. **Vendor-added material still pending.** Admin → Vendors → Materials →
   **Approve material**. Until then it is hidden from customers by design.
2. **Material not marked Available** for that vendor.
3. **Vendor's business pincode is blank or different**, and their shop
   location was never pinned, so distance cannot be computed either.
4. **Vendor is not Active/Approved.**
5. **Material itself is inactive or deleted** in the master catalog.

## Delivery estimates

There is no routing engine behind these; they are honest distance tiers:

| Distance | Shown |
|---|---|
| Same pincode, or ≤ 10 km | Delivers within 2 hours |
| ≤ 25 km | Delivers within 4 hours |
| Further, or distance unknown | Delivery time confirmed on order |
