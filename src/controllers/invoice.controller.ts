import { Request, Response, NextFunction } from "express";
import Invoice from "../models/Invoice.model";
import { AppError } from "../middlewares/errorHandler";
import { AuthRequest } from "../types";
import { ensureInvoicesGenerated, renderInvoiceHtml } from "../services/invoiceService";

/**
 * POST /api/bookings/:id/invoices/generate
 * Admin manual "Generate Invoice" action — idempotent, so it's also safe as
 * a "regenerate/force retry" button if auto-generation didn't fire yet
 * (e.g. delivery and payment confirmation happened through different flows).
 */
export const generateInvoices = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const invoices = await ensureInvoicesGenerated(req.params.id);
    if (invoices.length === 0) {
      throw new AppError(
        "Invoices can only be generated once the order is delivered and payment is confirmed.",
        400,
      );
    }
    res.json({ success: true, data: invoices });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/bookings/:id/invoices
 * Admin — list generated invoices (both types) for a booking.
 */
export const getBookingInvoices = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const invoices = await Invoice.find({ booking: req.params.id }).sort({
      createdAt: 1,
    });
    res.json({ success: true, data: invoices });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/invoices/:id/html
 * Admin — printable HTML view of a generated invoice (either type).
 */
export const getInvoiceHtml = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) throw new AppError("Invoice not found.", 404);

    const html = await renderInvoiceHtml(invoice);
    if (!html) throw new AppError("Could not render invoice.", 500);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error) {
    next(error);
  }
};
