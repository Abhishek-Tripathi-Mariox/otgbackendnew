import { Response, NextFunction, Request } from "express";
import mongoose from "mongoose";
import HelpSettings from "../models/HelpSettings.model";
import SupportTicket from "../models/SupportTicket.model";
import { AuthRequest } from "../types";
import { UserRequest } from "../middlewares/userAuth.middleware";
import { AppError } from "../middlewares/errorHandler";

const normalizeMobile = (m: string): string =>
  String(m || "").replace(/^\+91/, "").replace(/\s+/g, "").trim();

// ============= HELP SETTINGS =============

// Public (customer app) — returns only non-empty fields so the UI can skip them
export const getPublicHelpSettings = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const settings = await HelpSettings.findOne({ key: "default" });
    res.json({
      success: true,
      data: {
        address: settings?.address || null,
        mobile: settings?.mobile || null,
        email: settings?.email || null,
        whatsappNumber: settings?.whatsappNumber || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Admin — returns whatever is saved (including empty fields, so the form can render)
export const getAdminHelpSettings = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const settings = await HelpSettings.findOne({ key: "default" });
    res.json({
      success: true,
      data: settings || {
        key: "default",
        address: "",
        mobile: "",
        email: "",
        whatsappNumber: "",
      },
    });
  } catch (error) {
    next(error);
  }
};

// Admin upsert — all fields optional
export const upsertHelpSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { address, mobile, email, whatsappNumber } = req.body;

    // Email format check (only if provided)
    if (email && !/^\S+@\S+\.\S+$/.test(String(email).trim())) {
      throw new AppError("Enter a valid email", 400);
    }

    const update: any = {
      address: address?.trim() || "",
      mobile: mobile ? normalizeMobile(mobile) : "",
      email: email?.trim() || "",
      whatsappNumber: whatsappNumber ? normalizeMobile(whatsappNumber) : "",
      updatedBy: new mongoose.Types.ObjectId(req.admin!._id),
    };

    const settings = await HelpSettings.findOneAndUpdate(
      { key: "default" },
      { $set: update, $setOnInsert: { key: "default" } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    res.json({
      success: true,
      message: "Help settings updated",
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};

// ============= SUPPORT TICKETS =============

// Customer (mobile) submit
export const createSupportTicket = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, mobile, email, message } = req.body;
    const cleanMobile = normalizeMobile(mobile);

    if (!name?.trim()) throw new AppError("Name is required", 400);
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      throw new AppError("Enter a valid 10-digit mobile number", 400);
    }
    if (!message?.trim()) {
      throw new AppError("Please describe your issue", 400);
    }

    const ticket = await SupportTicket.create({
      user: req.user?.id || undefined,
      name: name.trim(),
      mobile: cleanMobile,
      email: email?.trim() || undefined,
      message: message.trim(),
      status: "open",
    });

    res.status(201).json({
      success: true,
      message: "Your message has been received",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// Customer (mobile) list-mine
export const listMySupportTickets = async (
  req: UserRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user?.id) throw new AppError("Authentication required", 401);
    const tickets = await SupportTicket.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ success: true, data: tickets });
  } catch (error) {
    next(error);
  }
};

// Admin list
export const listSupportTickets = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      search = "",
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: any = {};
    if (status && status !== "all") query.status = status;
    if (search) {
      const s = String(search);
      query.$or = [
        { ticketCode: { $regex: s, $options: "i" } },
        { name: { $regex: s, $options: "i" } },
        { mobile: { $regex: s, $options: "i" } },
        { email: { $regex: s, $options: "i" } },
        { message: { $regex: s, $options: "i" } },
      ];
    }

    const [tickets, total] = await Promise.all([
      SupportTicket.find(query)
        .populate("user", "name mobile email")
        .populate("assignedTo", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      SupportTicket.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: tickets,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Admin counts (for tabs)
export const supportTicketCounts = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const [open, inProgress, resolved, closed] = await Promise.all([
      SupportTicket.countDocuments({ status: "open" }),
      SupportTicket.countDocuments({ status: "in_progress" }),
      SupportTicket.countDocuments({ status: "resolved" }),
      SupportTicket.countDocuments({ status: "closed" }),
    ]);
    res.json({
      success: true,
      data: {
        open,
        in_progress: inProgress,
        resolved,
        closed,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Admin reply
export const replyToSupportTicket = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { message, status } = req.body;
    if (!message?.trim()) {
      throw new AppError("Reply message is required", 400);
    }
    const ticket = await SupportTicket.findById(id);
    if (!ticket) throw new AppError("Ticket not found", 404);

    ticket.replies.push({
      by: "admin",
      message: message.trim(),
      authorId: new mongoose.Types.ObjectId(req.admin!._id),
      createdAt: new Date(),
    } as any);

    if (status && ["open", "in_progress", "resolved", "closed"].includes(status)) {
      ticket.status = status;
      if (status === "resolved" || status === "closed") {
        ticket.resolvedAt = new Date();
      }
    } else if (ticket.status === "open") {
      ticket.status = "in_progress";
    }

    if (!ticket.assignedTo) {
      ticket.assignedTo = new mongoose.Types.ObjectId(req.admin!._id);
    }

    await ticket.save();
    const populated = await SupportTicket.findById(id)
      .populate("user", "name mobile email")
      .populate("assignedTo", "name email");
    res.json({
      success: true,
      message: "Reply sent",
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

// Admin update status
export const updateSupportTicketStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!["open", "in_progress", "resolved", "closed"].includes(status)) {
      throw new AppError("Invalid status", 400);
    }
    const ticket = await SupportTicket.findById(id);
    if (!ticket) throw new AppError("Ticket not found", 404);
    ticket.status = status;
    if (status === "resolved" || status === "closed") {
      ticket.resolvedAt = new Date();
    }
    await ticket.save();
    res.json({
      success: true,
      message: `Ticket marked as ${status.replace("_", " ")}`,
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// Admin delete
export const deleteSupportTicket = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const ticket = await SupportTicket.findByIdAndDelete(id);
    if (!ticket) throw new AppError("Ticket not found", 404);
    res.json({ success: true, message: "Ticket deleted" });
  } catch (error) {
    next(error);
  }
};
