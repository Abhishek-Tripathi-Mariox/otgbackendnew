// Shared GST "Tax Invoice" HTML renderer, used by both the vendor app
// (vendor -> customer invoice) and the customer app (order invoice) so the
// two stay visually identical.

export const escInv = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export const inr = (n: number): string =>
  `₹&nbsp;${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Convert a number to Indian-format words (for "Amount in words").
export const numToWords = (num: number): string => {
  const n = Math.round(Number(num) || 0);
  if (n === 0) return "Zero";
  const a = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const b = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  const two = (x: number): string =>
    x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? " " + a[x % 10] : ""}`;
  const three = (x: number): string =>
    x >= 100
      ? `${a[Math.floor(x / 100)]} Hundred${x % 100 ? " " + two(x % 100) : ""}`
      : two(x);
  let res = "";
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n / 100000) % 100);
  const thousand = Math.floor((n / 1000) % 100);
  const hundred = n % 1000;
  if (crore) res += `${three(crore)} Crore `;
  if (lakh) res += `${two(lakh)} Lakh `;
  if (thousand) res += `${two(thousand)} Thousand `;
  if (hundred) res += three(hundred);
  return res.trim();
};

export interface TaxInvoiceParams {
  sellerName: string;
  sellerAddress?: string;
  sellerCity?: string;
  sellerPincode?: string;
  sellerState?: string;
  sellerGstin?: string;
  sellerMobile?: string;
  sellerEmail?: string;
  sellerPan?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankName?: string;
  invoiceNo: string;
  orderNo: string;
  issuedDate: string;
  paymentMethod?: string;
  consigneeName: string;
  consigneeAddress?: string;
  consigneeMobile?: string;
  dispatchThrough?: string;
  vehicleNumber?: string;
  materialName: string;
  hsn?: string;
  unit?: string;
  quantity: number;
  rate: number;
  basic: number;
  gstRate: number; // total GST rate, e.g. 18 for 18%
  cgst: number;
  sgst: number;
  total: number;
}

export const buildTaxInvoiceHtml = (p: TaxInvoiceParams): string => {
  const halfRate = p.gstRate / 2;
  const gstAmount = p.cgst + p.sgst;
  const hsn = p.hsn || "-";

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Tax Invoice ${escInv(p.invoiceNo)}</title>
<style>
  *{box-sizing:border-box}
  html,body{max-width:100%;overflow-x:hidden}
  body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0;padding:16px;font-size:12px}
  .sheet{max-width:820px;margin:0 auto;border:1px solid #000}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  td,th{border:1px solid #000;padding:4px 6px;vertical-align:top;word-break:break-word;overflow-wrap:anywhere}
  .nob td,.nob th{border:none}
  .c{text-align:center}.r{text-align:right;white-space:nowrap}.b{font-weight:bold}
  h1{font-size:18px;margin:6px 0}
  .title{font-size:14px;font-weight:bold;text-align:center;letter-spacing:1px}
  .muted{color:#333}
  .btn{display:inline-block;margin:12px auto 0;background:#E48714;color:#fff;padding:8px 16px;border-radius:6px;border:0;cursor:pointer;font-size:13px}
  @media print{.btn{display:none}body{padding:0}}
  @media (max-width:480px){
    body{padding:6px;font-size:9.5px}
    td,th{padding:3px 4px}
    .title{font-size:12px}
    h1{font-size:15px}
  }
</style></head>
<body>
  <div class="sheet">
    <div class="c b" style="padding:8px;border-bottom:1px solid #000;font-size:18px">
      ${escInv(p.sellerName)}
    </div>
    <div class="title" style="padding:4px;border-bottom:1px solid #000">TAX INVOICE</div>

    <table>
      <tr>
        <td style="width:42%" rowspan="2">
          <div class="b">Vendor Details</div>
          <div>${escInv(p.sellerName)}</div>
          <div class="muted">${escInv(p.sellerAddress || "")}</div>
          <div class="muted">${escInv(p.sellerCity || "")}${p.sellerPincode ? " - " + escInv(p.sellerPincode) : ""}</div>
          <div class="muted">GSTIN/UIN: ${escInv(p.sellerGstin || "-")}</div>
          <div class="muted">State: ${escInv(p.sellerState || "-")}</div>
          <div class="muted">Mobile: ${escInv(p.sellerMobile || "-")}</div>
          ${p.sellerEmail ? `<div class="muted">E-Mail: ${escInv(p.sellerEmail)}</div>` : ""}
        </td>
        <td style="width:29%"><span class="b">Invoice No.</span><br/>${escInv(p.invoiceNo)}</td>
        <td style="width:29%"><span class="b">Dated</span><br/>${escInv(p.issuedDate)}</td>
      </tr>
      <tr>
        <td><span class="b">Mode/Terms of Payment</span><br/>${escInv(p.paymentMethod || "Wire Transfer / Cheque")}</td>
        <td><span class="b">Order No.</span><br/>${escInv(p.orderNo)}</td>
      </tr>
      <tr>
        <td>
          <div class="b">Consignee (Ship to)</div>
          <div>${escInv(p.consigneeName)}</div>
          <div class="muted">${escInv(p.consigneeAddress || "")}</div>
          <div class="muted">Mobile: ${escInv(p.consigneeMobile || "-")}</div>
        </td>
        <td><span class="b">Despatched through</span><br/>${escInv(p.dispatchThrough || "-")}</td>
        <td><span class="b">Vehicle No.</span><br/>${escInv(p.vehicleNumber || "-")}</td>
      </tr>
    </table>

    <table>
      <tr class="b c">
        <td style="width:6%">Sr No.</td>
        <td style="width:34%">Description of Material</td>
        <td style="width:12%">HSN/SAC</td>
        <td style="width:8%">Unit</td>
        <td style="width:12%">Quantity</td>
        <td style="width:14%">Rate</td>
        <td style="width:14%">Amount</td>
      </tr>
      <tr>
        <td class="c">1</td>
        <td>${escInv(p.materialName)}</td>
        <td class="c">${escInv(hsn)}</td>
        <td class="c">${escInv(p.unit || "")}</td>
        <td class="c">${escInv(p.quantity)}</td>
        <td class="r">${inr(p.rate)}</td>
        <td class="r">${inr(p.basic)}</td>
      </tr>
      <tr><td colspan="6" class="r b">Basic Amount</td><td class="r">${inr(p.basic)}</td></tr>
      <tr><td colspan="6" class="r">CGST ( ${halfRate}% )</td><td class="r">${inr(p.cgst)}</td></tr>
      <tr><td colspan="6" class="r">SGST ( ${halfRate}% )</td><td class="r">${inr(p.sgst)}</td></tr>
      <tr><td colspan="6" class="r b">Total</td><td class="r b">${inr(p.total)}</td></tr>
    </table>

    <table class="nob"><tr><td style="border:1px solid #000">
      <span class="b">Amount Chargeable (in words):</span> ${escInv(numToWords(p.total))} Rupees Only
    </td></tr></table>

    <table>
      <tr class="b c">
        <td rowspan="2" style="width:28%">HSN/SAC</td>
        <td rowspan="2" style="width:16%">Taxable Value</td>
        <td colspan="2">Central Tax</td>
        <td colspan="2">State Tax</td>
        <td rowspan="2">Total Tax Amount</td>
      </tr>
      <tr class="b c"><td>Rate</td><td>Amount</td><td>Rate</td><td>Amount</td></tr>
      <tr class="c">
        <td>${escInv(hsn)}</td>
        <td class="r">${inr(p.basic)}</td>
        <td>${halfRate}%</td>
        <td class="r">${inr(p.cgst)}</td>
        <td>${halfRate}%</td>
        <td class="r">${inr(p.sgst)}</td>
        <td class="r">${inr(gstAmount)}</td>
      </tr>
    </table>

    <table class="nob"><tr><td style="border:1px solid #000">
      <span class="b">Tax Amount (in words):</span> ${escInv(numToWords(gstAmount))} Rupees Only
    </td></tr></table>

    <table>
      <tr>
        <td style="width:50%">
          <div>Company's PAN: ${escInv(p.sellerPan || "-")}</div>
          <div>Bank A/c No.: ${escInv(p.bankAccountNumber || "-")}</div>
          <div>IFSC code: ${escInv(p.bankIfsc || "-")}</div>
          <div>Bank: ${escInv(p.bankName || "-")}</div>
          <br/>
          <div class="b">Declaration</div>
          <div class="muted">We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</div>
        </td>
        <td class="r" style="width:50%">
          <div style="height:70px"></div>
          <div class="b">for ${escInv(p.sellerName)}</div>
          <div style="height:40px"></div>
          <div>Authorised Signatory</div>
        </td>
      </tr>
    </table>
  </div>
  <div class="c"><button class="btn" onclick="window.print()">Download / Print PDF</button></div>
</body></html>`;
};
