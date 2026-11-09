#!/usr/bin/env bash
#
# End-to-end smoke test for the OTG backend.
#
# Covers the behaviours that are easy to break and expensive to get wrong:
# bulk-order lifecycle, vendor/customer price confidentiality, the dual-rate
# model, region/pincode vendor search, order status as the customer sees it,
# and the admin material flows.
#
# It PLACES ORDERS and CREATES RECORDS, so never point it at production.
# Intended usage is a throwaway local database restored from a dump:
#
#   mongodump --uri="<dev uri>" --out /tmp/otgdump
#   mongorestore --uri="mongodb://127.0.0.1:27017" \
#       --nsFrom='otg_admin_panel.*' --nsTo='otg_local.*' --drop /tmp/otgdump
#   MONGODB_URI='mongodb://127.0.0.1:27017/otg_local' PORT=5099 \
#       npx ts-node --transpile-only src/server.ts &
#   ./scripts/e2e-smoke.sh
#
# Env:
#   API_BASE   default http://127.0.0.1:5099/api
#   TEST_DB    default otg_local   (used for direct assertions via mongosh)
#   ADMIN_EMAIL / ADMIN_PASSWORD   default admin@otg.com / OtgAdmin@2026
#
# Requires: curl, jq, mongosh.

set -uo pipefail
B="${API_BASE:-http://127.0.0.1:5099/api}"
DB="${TEST_DB:-otg_local}"
AEMAIL="${ADMIN_EMAIL:-admin@otg.com}"
APASS="${ADMIN_PASSWORD:-OtgAdmin@2026}"

PASS=0; FAIL=0
ok(){ echo "  PASS  $1"; PASS=$((PASS+1)); }
no(){ echo "  FAIL  $1"; echo "        got: $2"; FAIL=$((FAIL+1)); }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "$2 (want $3)"; fi; }
q(){ mongosh --quiet "$DB" --eval "$1"; }

for bin in curl jq mongosh; do
  command -v "$bin" >/dev/null || { echo "missing dependency: $bin"; exit 2; }
done
curl -sf -m 5 "$B/health" >/dev/null || { echo "API not reachable at $B"; exit 2; }

AT=$(curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$AEMAIL\",\"password\":\"$APASS\"}" | jq -r '.data.token // empty')
[ -n "$AT" ] || { echo "admin login failed"; exit 2; }
AH="Authorization: Bearer $AT"

ulogin(){ curl -s -X POST "$B/mobile/auth/send-otp" -H 'Content-Type: application/json' -d "{\"mobile\":\"$1\"}">/dev/null
  local o; o=$(curl -s -X POST "$B/mobile/auth/send-otp" -H 'Content-Type: application/json' -d "{\"mobile\":\"$1\"}"|jq -r '.otp // .data.otp // "123456"')
  curl -s -X POST "$B/mobile/auth/verify-otp" -H 'Content-Type: application/json' -d "{\"mobile\":\"$1\",\"otp\":\"$o\"}"|jq -r '.data.token // .token'; }
vlogin(){ curl -s -X POST "$B/vendor/auth/send-otp" -H 'Content-Type: application/json' -d "{\"mobile\":\"$1\"}">/dev/null
  local o; o=$(curl -s -X POST "$B/vendor/auth/send-otp" -H 'Content-Type: application/json' -d "{\"mobile\":\"$1\"}"|jq -r '.otp // .data.otp // "123456"')
  curl -s -X POST "$B/vendor/auth/verify-otp" -H 'Content-Type: application/json' -d "{\"mobile\":\"$1\",\"otp\":\"$o\"}"|jq -r '.data.token // .token'; }

# --- fixtures from the restored data -----------------------------------
WP=$(q 'const m=db.materials.findOne({name:"Wonder Plus Cement"}); print(m?m._id.toString():"")')
RCC=$(q 'const c=db.categories.findOne({name:"RCC Materials"}); print(c?c._id.toString():"")')
CEMSUB=$(q 'const s=db.subcategories.findOne({name:"CEMENT",isDeleted:false}); print(s?s._id.toString():"")')
HID=$(q 'const v=db.vendors.findOne({vendorCode:"VND-00013"}); print(v?v._id.toString():"")')
HMOB=$(q 'const v=db.vendors.findOne({vendorCode:"VND-00013"}); print(v?v.mobile:"")')
OTGID=$(q 'const v=db.vendors.findOne({vendorCode:"VND-00022"}); print(v?v._id.toString():"")')
PIN=422001
if [ -z "$WP" ] || [ -z "$HID" ]; then
  echo "Expected fixture data not found in '$DB' (Wonder Plus Cement / VND-00013)."
  echo "Restore a dev dump first — see the header of this file."; exit 2
fi

echo "== catalogue reachability =="
chk "CEMENT chip is offered under RCC" \
  "$(curl -s "$B/mobile/catalog/categories/$RCC/subcategories"|jq -r '[.data[]|select(.name=="CEMENT")]|length')" "1"
chk "tapping CEMENT returns materials (not an empty screen)" \
  "$(curl -s "$B/mobile/catalog/materials?category=$RCC&subCategory=$CEMSUB&limit=50"|jq -r '.pagination.total > 0')" "true"
chk "no dead sub-category chips" \
  "$(for sc in $(curl -s "$B/mobile/catalog/categories/$RCC/subcategories"|jq -r '.data[]._id'); do
       curl -s "$B/mobile/catalog/materials?category=$RCC&subCategory=$sc&limit=1"|jq -r '.pagination.total'; done | grep -c '^0$')" "0"

echo "== region search: comparison =="
C=$(curl -s "$B/mobile/catalog/materials/$WP/vendors?pincode=$PIN")
chk "suppliers returned for $PIN"        "$(echo "$C"|jq -r '.data|length > 0')" "true"
chk "same-pincode supplier ranked first" "$(echo "$C"|jq -r '.data[0].samePincode')" "true"
chk "every option has a delivery line"   "$(echo "$C"|jq -r '[.data[]|select(.deliveryEstimate==null)]|length')" "0"
chk "price_asc sorts cheapest first" \
  "$(curl -s "$B/mobile/catalog/materials/$WP/vendors?pincode=$PIN&sort=price_asc"|jq -r '[.data[].price]|.[0] == (.|min)')" "true"
chk "maxDeliveryHours=2 keeps only fast suppliers" \
  "$(curl -s "$B/mobile/catalog/materials/$WP/vendors?pincode=$PIN&maxDeliveryHours=2"|jq -r '[.data[]|select(.deliveryEtaHours!=2)]|length')" "0"
chk "invalid sort falls back instead of erroring" \
  "$(curl -s "$B/mobile/catalog/materials/$WP/vendors?pincode=$PIN&sort=bogus"|jq -r '.success')" "true"

echo "== search: one row per vendor offer =="
E=$(curl -s "$B/mobile/catalog/materials?search=cement&limit=20&pincode=$PIN&expandVendors=1")
chk "offer rows carry a vendor code" "$(echo "$E"|jq -r '[.data[]|select(.vendor!=null and .vendor.code==null)]|length')" "0"
chk "offerKey unique per row"        "$(echo "$E"|jq -r '[.data[].offerKey]|length as $a|unique|length as $b|$a==$b')" "true"
chk "products with no supplier still listed" "$(echo "$E"|jq -r '[.data[]|select(.vendor==null)]|length > 0')" "true"
chk "summary mode unchanged without expandVendors" \
  "$(curl -s "$B/mobile/catalog/materials?search=Wonder&limit=10&pincode=$PIN"|jq -r '.data[0]|has("supplierSummary")')" "true"
chk "no pincode -> no vendor fields" \
  "$(curl -s "$B/mobile/catalog/materials?search=Wonder&limit=5"|jq -r '.data[0]|has("vendor") or has("supplierSummary")')" "false"

echo "== confidentiality: customer never sees the vendor COST rate =="
# Material-specific on purpose: a cost rate for one product can legitimately
# equal a customer price for another, so a global "is this number a cost?"
# check would false-positive. Compare against THIS material's own rates.
WP_COSTS=$(q "print(JSON.stringify(db.vendormaterials.find({material:ObjectId('$WP')}).toArray().map(r=>r.price)))")
WP_CUST=$(q "print(JSON.stringify(db.vendormaterials.find({material:ObjectId('$WP')}).toArray().map(r=>r.customerPrice).filter(v=>v!=null)))")
WP_SHOWN=$(curl -s "$B/mobile/catalog/materials/$WP/vendors?pincode=$PIN" | jq -c '[.data[].price]|sort')
chk "no shown price equals this material's vendor COST" \
  "$(echo "$WP_SHOWN" | jq -r --argjson costs "$WP_COSTS" '[.[]|select(. as $x|$costs|index($x))]|length')" "0"
chk "shown prices are exactly this material's customer rates" \
  "$WP_SHOWN" "$(echo "$WP_CUST" | jq -c 'sort')"
chk "storefront exposes no cost rate" \
  "$(curl -s "$B/mobile/catalog/vendors/$OTGID"|jq -r '[.data.materials[]|select(has("price"))]|length')" "0"

echo "== vendor identity: customer sees the CODE, never the trading name =="
chk "comparison rows carry a vendor code" \
  "$(curl -s "$B/mobile/catalog/materials/$WP/vendors?pincode=$PIN"|jq -r '[.data[]|select(.vendorCode==null)]|length')" "0"
chk "comparison rows expose no vendorName field" \
  "$(curl -s "$B/mobile/catalog/materials/$WP/vendors?pincode=$PIN"|jq -r '[.data[]|select(has("vendorName"))]|length')" "0"
chk "storefront header is a code, not a name" \
  "$(curl -s "$B/mobile/catalog/vendors/$OTGID"|jq -r '.data.vendor|has("name")')" "false"
# The real guarantee: no vendor's actual trading name appears anywhere in a
# customer-facing payload. Knowing it would let a buyer go direct to the
# supplier and cut OTG out of the deal it sourced.
VNAMES=$(q 'const o=[]; db.vendors.find({isDeleted:{$ne:true}},{name:1,"business.name":1}).forEach(v=>{if(v.name)o.push(v.name); if(v.business&&v.business.name)o.push(v.business.name)}); print([...new Set(o)].filter(n=>n&&n.length>2).join("\n"))')
LEAKS=0
for ep in "mobile/catalog/materials/$WP/vendors?pincode=$PIN" \
          "mobile/catalog/materials?search=cement&limit=20&pincode=$PIN&expandVendors=1" \
          "mobile/catalog/vendors/$OTGID"; do
  BODY=$(curl -s "$B/$ep")
  while IFS= read -r n; do
    [ -n "$n" ] && echo "$BODY" | grep -qiF -- "$n" && LEAKS=$((LEAKS+1))
  done <<< "$VNAMES"
done
chk "no vendor trading name in any customer payload" "$LEAKS" "0"

echo "== bulk order lifecycle =="
UT=$(ulogin 9876590001); UH="Authorization: Bearer $UT"
[ -n "$UT" ] && ok "customer OTP login" || no "customer OTP login" "no token"
QID=$(curl -s -X POST "$B/quotations" -H "$UH" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Buyer\",\"mobile\":\"9876590001\",\"pincode\":\"$PIN\",\"items\":[{\"materialName\":\"Cement\",\"quantity\":\"500\",\"unit\":\"bag\"}]}"|jq -r '.data._id')
R=$(curl -s -X PATCH "$B/quotations/$QID/respond" -H "$AH" -H 'Content-Type: application/json' -d '{"quotedValidTill":"2026-12-31"}')
chk "quote sent with no price field" "$(echo "$R"|jq -r '.data.quotedPrice')" "null"
chk "standard PDF note applied"      "$(echo "$R"|jq -r '.data.adminNotes')" \
  "We have shared the quote in PDF format, please review and revert."
curl -s -X PATCH "$B/quotations/me/$QID/status" -H "$UH" -H 'Content-Type: application/json' -d '{"status":"accepted"}' >/dev/null
chk "acceptance moves to procurement" "$(curl -s "$B/quotations/$QID" -H "$AH"|jq -r '.data.status')" "procurement"
chk "admin can mark completed"        "$(curl -s -X PATCH "$B/quotations/$QID/complete" -H "$AH"|jq -r '.data.status')" "completed"

echo "== vendor confidentiality on an assigned quotation =="
curl -s -X PATCH "$B/quotations/$QID/assign-vendor" -H "$AH" -H 'Content-Type: application/json' \
  -d "{\"vendorId\":\"$HID\",\"vendorRate\":41000}" >/dev/null
VT=$(vlogin "$HMOB")
VQ=$(curl -s "$B/quotations/vendor/assigned/$QID" -H "Authorization: Bearer $VT")
chk "vendor sees own PO rate"       "$(echo "$VQ"|jq -r '.data.vendorRate')" "41000"
chk "vendor cannot see adminNotes"  "$(echo "$VQ"|jq -r '.data.adminNotes // "absent"')" "absent"
chk "vendor cannot see quotedPrice" "$(echo "$VQ"|jq -r '.data.quotedPrice // "absent"')" "absent"
chk "vendor cannot see invoicePdf"  "$(echo "$VQ"|jq -r '.data.invoicePdf // "absent"')" "absent"
VM=$(curl -s "$B/vendor/inventory/my-materials" -H "Authorization: Bearer $VT")
chk "vendor cannot see customerPrice"        "$(echo "$VM"|jq -r '[.data[]|select(.customerPrice!=null)]|length')" "0"
chk "vendor cannot see catalog sellingPrice" "$(echo "$VM"|jq -r '[.data[]|select(.material.sellingPrice!=null)]|length')" "0"

echo "== order status as the customer sees it =="
BUY="{\"accountType\":\"individual\",\"name\":\"Smoke Buyer\",\"mobile\":\"9876590001\",\"deliveryAddress\":\"1 Test Rd\",\"city\":\"Nashik\",\"pincode\":\"$PIN\"}"
ORD=$(curl -s -X POST "$B/mobile/orders" -H "$UH" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"materialId\":\"$WP\",\"quantity\":10,\"vendorId\":\"$HID\"}],\"paymentMethod\":\"cod\",\"site\":\"Site A\",\"pincode\":\"$PIN\",\"buyerDetails\":$BUY}")
OID=$(echo "$ORD"|jq -r '.data[0]._id // .data._id')
chk "order placed" "$(echo "$ORD"|jq -r '.success')" "true"
chk "charged the chosen vendor's rate" \
  "$(echo "$ORD"|jq -r '[.data[]?.price]|add // .data.price')" \
  "$(curl -s "$B/mobile/catalog/materials/$WP/vendors?pincode=$PIN"|jq -r --arg v "$HID" '[.data[]|select(.vendorId==$v)][0].price')"
chk "new order is ONGOING, not Past" \
  "$(curl -s "$B/mobile/orders?status=ongoing" -H "$UH"|jq -r --arg o "$OID" '[.data[]|select(._id==$o)]|length')" "1"
curl -s -X PATCH "$B/vendor/orders/$OID/status" -H "Authorization: Bearer $VT" \
  -H 'Content-Type: application/json' -d '{"action":"accept"}' >/dev/null
chk "customer sees 'accepted' after vendor accepts" \
  "$(curl -s "$B/mobile/orders/$OID" -H "$UH"|jq -r '.data.status')" "accepted"
TR=$(curl -s "$B/mobile/orders/$OID/tracking" -H "$UH")
chk "Accepted step is done"             "$(echo "$TR"|jq -r '.data.steps[]|select(.key=="accepted")|.done')" "true"
chk "Accepted step has a timestamp"     "$(echo "$TR"|jq -r '.data.steps[]|select(.key=="accepted")|.at != null')" "true"
chk "tracking explains the status"      "$(echo "$TR"|jq -r '.data.statusNote != null')" "true"
curl -s -X PUT "$B/bookings/$OID" -H "$AH" -H 'Content-Type: application/json' -d '{"status":"dispatched"}' >/dev/null
chk "admin status jump records history" \
  "$(curl -s "$B/mobile/orders/$OID/tracking" -H "$UH"|jq -r '.data.steps[]|select(.key=="dispatched")|.at != null')" "true"

echo "== sites can be saved without GPS =="
curl -s -X POST "$B/mobile/auth/addresses" -H "$UH" -H 'Content-Type: application/json' \
  -d "{\"label\":\"Site\",\"line\":\"Plot 7, Nashik $PIN\",\"street\":\"Plot 7\",\"city\":\"Nashik\",\"pincode\":\"$PIN\"}" >/dev/null
chk "site saved with no coordinates" \
  "$(curl -s "$B/mobile/auth/addresses" -H "$UH"|jq -r '[.data[]|select(.lat==null)]|length >= 1')" "true"

echo
echo "RESULT: $PASS passed, $FAIL failed"
exit $((FAIL>0))
