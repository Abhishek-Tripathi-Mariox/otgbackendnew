import Booking from "../models/Booking.model";
import Invoice, { IInvoiceDocument, InvoiceType } from "../models/Invoice.model";
import AppSettings from "../models/AppSettings.model";
import { buildTaxInvoiceHtml } from "../utils/taxInvoiceHtml";

/**
 * Idempotently generates both invoice types (vendor->customer, vendor->OTG)
 * for a booking once it's delivered AND paid — safe to call from multiple
 * places (driver delivery-complete, admin status update, Razorpay verify/
 * webhook) since each is a no-op if the invoice already exists for that
 * (booking, type) pair (enforced by the model's unique compound index).
 * Never throws — invoice generation must never block the caller's real
 * response (order status update, payment verification, etc).
 */
export const ensureInvoicesGenerated = async (
  bookingId: string,
): Promise<IInvoiceDocument[]> => {
  try {
    const booking: any = await Booking.findById(bookingId)
      .populate("vendor", "name email mobile business bankDetails")
      .populate("user", "name mobile email address")
      .lean();

    if (!booking) return [];
    if (booking.status !== "delivered" || booking.paymentStatus !== "completed") {
      return [];
    }

    const vendor = booking.vendor || {};
    const biz = vendor.business || {};
    const bank = vendor.bankDetails || {};
    const cust = booking.user || {};

    const vendorSnapshot = {
      name: biz.name || vendor.name || "Vendor",
      address: biz.address || "",
      city: biz.city || "",
      state: biz.state || "",
      pincode: biz.pincode || "",
      gstin: biz.gstNumber || "",
      pan: biz.panNumber || "",
      mobile: vendor.mobile || "",
      email: vendor.email || "",
      bankAccountNumber: bank.accountNumber || "",
      bankIfsc: bank.ifscCode || "",
      bankName: bank.bankName || "",
    };

    const settings = await AppSettings.findOne({ key: "default" }).lean();
    const company = settings?.companyProfile || ({} as Record<string, string>);
    const companySnapshot = {
      name: company.name || "OTG",
      address: company.address || "",
      city: company.city || "",
      state: company.state || "",
      pincode: company.pincode || "",
      gstin: company.gstin || "",
      pan: company.pan || "",
      bankAccountNumber: company.bankAccountNumber || "",
      bankIfsc: company.bankIfsc || "",
      bankName: company.bankName || "",
    };

    // The "vendor_to_customer" type key is legacy naming — in substance this
    // is now the buyer-facing invoice with OTG (not the vendor) as seller of
    // record, matching a marketplace where the vendor is a backend supplier
    // the customer never sees. "vendor_to_otg" (the procurement invoice) is
    // unchanged: vendor sells to OTG at the vendor's own rate.
    const sellerSnapshots: Record<InvoiceType, Record<string, unknown>> = {
      vendor_to_customer: companySnapshot,
      vendor_to_otg: vendorSnapshot,
    };

    // Source the customer-facing buyer snapshot from the frozen per-order
    // buyerDetails, not a live User read — matches getOrderInvoiceHtml's
    // rationale (a later profile edit must never rewrite a past invoice).
    // Falls back to the live User for orders placed before this field existed.
    const buyer = booking.buyerDetails || {};
    const buyerSnapshots: Record<InvoiceType, Record<string, unknown>> = {
      vendor_to_customer: {
        name: buyer.name || cust.name || "Customer",
        address: buyer.deliveryAddress || booking.site || cust.address?.full || "",
        mobile: buyer.mobile || cust.mobile || "",
      },
      vendor_to_otg: companySnapshot,
    };

    const created: IInvoiceDocument[] = [];
    for (const type of ["vendor_to_customer", "vendor_to_otg"] as InvoiceType[]) {
      const existing = await Invoice.findOne({ booking: booking._id, type });
      if (existing) {
        created.push(existing);
        continue;
      }
      const invoice = await Invoice.create({
        type,
        booking: booking._id,
        sellerSnapshot: sellerSnapshots[type],
        buyerSnapshot: buyerSnapshots[type],
        amount: booking.totalAmount,
        generatedBy: "auto",
      });
      created.push(invoice);
    }

    return created;
  } catch (error) {
    console.error(`[invoiceService] Failed to generate invoices for booking ${bookingId}:`, error);
    return [];
  }
};

/**
 * Renders an already-generated Invoice as printable HTML, reusing the same
 * template as the live vendor->customer invoice — line items (material,
 * quantity, GST) are read fresh from the Booking (immutable after delivery)
 * while party details come from the invoice's frozen seller/buyer snapshot.
 */
export const renderInvoiceHtml = async (
  invoice: IInvoiceDocument,
): Promise<string | null> => {
  const booking: any = await Booking.findById(invoice.booking)
    .populate("material", "name unit gst hsn")
    .lean();
  if (!booking) return null;

  const seller = invoice.sellerSnapshot as any;
  const buyer = invoice.buyerSnapshot as any;
  const material = booking.material || {};

  const qty = Number(booking.quantity || 0);
  const total = Number(invoice.amount || booking.totalAmount || 0);
  const gstAmount = Number(booking.gstAmount || 0);
  const basic = Math.max(total - gstAmount, 0);
  const gstRate = Number(material.gst || 0);
  const rate = qty ? basic / qty : basic;
  const issued = new Date(invoice.generatedAt || booking.createdAt).toLocaleDateString(
    "en-IN",
  );

  return buildTaxInvoiceHtml({
    sellerName: seller?.name || "Vendor",
    sellerAddress: seller?.address,
    sellerCity: seller?.city,
    sellerPincode: seller?.pincode,
    sellerState: seller?.state,
    sellerGstin: seller?.gstin,
    sellerMobile: seller?.mobile,
    sellerEmail: seller?.email,
    sellerPan: seller?.pan,
    bankAccountNumber: seller?.bankAccountNumber,
    bankIfsc: seller?.bankIfsc,
    bankName: seller?.bankName,
    invoiceNo: invoice.invoiceNumber,
    orderNo: booking.bookingId,
    issuedDate: issued,
    paymentMethod: booking.paymentMethod,
    consigneeName: buyer?.name || "Buyer",
    consigneeAddress: buyer?.address,
    consigneeMobile: buyer?.mobile,
    dispatchThrough: booking.dispatch?.driverName,
    vehicleNumber: booking.dispatch?.vehicleNumber,
    materialName: material.name || "",
    hsn: material.hsn,
    unit: booking.unit || material.unit,
    quantity: qty,
    rate,
    basic,
    gstRate,
    cgst: gstAmount / 2,
    sgst: gstAmount / 2,
    total,
  });
};
