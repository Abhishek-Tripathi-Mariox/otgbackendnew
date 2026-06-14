import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Faq from "../models/Faq.model";
import { AppError } from "../middlewares/errorHandler";

// GET /api/mobile/catalog/faqs?category=<id>
// Public — active FAQs. Returns global FAQs (no category) plus any scoped to
// the given category.
export const getPublicFaqs = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { category } = req.query;
    const query: any = { status: "active", isDeleted: false };

    if (category && mongoose.isValidObjectId(category as string)) {
      query.$or = [{ category: null }, { category }];
    } else {
      query.category = null;
    }

    const faqs = await Faq.find(query)
      .select("question answer order")
      .sort({ order: 1, createdAt: 1 })
      .lean();

    res.json({ success: true, data: faqs });
  } catch (error) {
    next(error);
  }
};

// ===== Admin =====

// GET /api/faqs
export const adminListFaqs = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const faqs = await Faq.find({ isDeleted: false })
      .populate("category", "name")
      .sort({ order: 1, createdAt: 1 })
      .lean();
    res.json({ success: true, data: faqs });
  } catch (error) {
    next(error);
  }
};

// POST /api/faqs
export const adminCreateFaq = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { question, answer, category, order, status } = req.body || {};
    if (!question?.toString().trim() || !answer?.toString().trim()) {
      throw new AppError("Question and answer are required", 400);
    }
    const faq = await Faq.create({
      question: question.toString().trim(),
      answer: answer.toString().trim(),
      category:
        category && mongoose.isValidObjectId(category) ? category : null,
      order: Number(order) || 0,
      status: status === "inactive" ? "inactive" : "active",
    });
    res.status(201).json({ success: true, message: "FAQ created", data: faq });
  } catch (error) {
    next(error);
  }
};

// PUT /api/faqs/:id
export const adminUpdateFaq = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { question, answer, category, order, status } = req.body || {};

    const update: any = {};
    if (question !== undefined) update.question = question.toString().trim();
    if (answer !== undefined) update.answer = answer.toString().trim();
    if (category !== undefined) {
      update.category =
        category && mongoose.isValidObjectId(category) ? category : null;
    }
    if (order !== undefined) update.order = Number(order) || 0;
    if (status !== undefined) {
      update.status = status === "inactive" ? "inactive" : "active";
    }

    const faq = await Faq.findOneAndUpdate(
      { _id: id, isDeleted: false },
      update,
      { new: true },
    );
    if (!faq) throw new AppError("FAQ not found", 404);
    res.json({ success: true, message: "FAQ updated", data: faq });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/faqs/:id (soft delete)
export const adminDeleteFaq = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const faq = await Faq.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { isDeleted: true },
      { new: true },
    );
    if (!faq) throw new AppError("FAQ not found", 404);
    res.json({ success: true, message: "FAQ deleted" });
  } catch (error) {
    next(error);
  }
};
