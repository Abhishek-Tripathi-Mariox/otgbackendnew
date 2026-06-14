import { Response, NextFunction, Request } from "express";
import mongoose from "mongoose";
import CmsPage from "../models/CmsPage.model";
import { AuthRequest } from "../types";
import { AppError } from "../middlewares/errorHandler";

const slugify = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

// ===== ADMIN =====

export const listCmsPages = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const pages = await CmsPage.find({})
      .select("-body")
      .sort({ updatedAt: -1 });
    res.json({ success: true, data: pages });
  } catch (error) {
    next(error);
  }
};

export const getCmsPageById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const page = mongoose.Types.ObjectId.isValid(id)
      ? await CmsPage.findById(id)
      : await CmsPage.findOne({ slug: id });
    // Admin editor lookup: a missing page is the expected state when the
    // admin opens the editor for a page that hasn't been created yet, so
    // we return null rather than 404 to keep server logs clean.
    res.json({ success: true, data: page || null });
  } catch (error) {
    next(error);
  }
};

export const upsertCmsPage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { slug, title, description, body, status } = req.body;

    if (!slug || !title) {
      throw new AppError("Slug and title are required", 400);
    }

    const cleanSlug = slugify(slug);

    const existing = await CmsPage.findOne({ slug: cleanSlug });
    const adminId = new mongoose.Types.ObjectId(req.admin!._id);

    if (existing) {
      existing.title = title;
      if (description !== undefined) existing.description = description;
      if (body !== undefined) existing.body = body;
      if (status) existing.status = status;
      existing.updatedBy = adminId;
      await existing.save();
      res.json({
        success: true,
        message: "Page saved",
        data: existing,
      });
      return;
    }

    const page = await CmsPage.create({
      slug: cleanSlug,
      title,
      description,
      body: body || "",
      status: status || "published",
      updatedBy: adminId,
    });

    res.status(201).json({
      success: true,
      message: "Page created",
      data: page,
    });
  } catch (error) {
    next(error);
  }
};

export const updateCmsPage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { title, description, body, status } = req.body;

    const page = await CmsPage.findById(id);
    if (!page) throw new AppError("Page not found", 404);

    if (title !== undefined) page.title = title;
    if (description !== undefined) page.description = description;
    if (body !== undefined) page.body = body;
    if (status !== undefined) page.status = status;
    page.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);

    await page.save();

    res.json({
      success: true,
      message: "Page updated",
      data: page,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteCmsPage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const page = await CmsPage.findByIdAndDelete(id);
    if (!page) throw new AppError("Page not found", 404);
    res.json({ success: true, message: "Page deleted" });
  } catch (error) {
    next(error);
  }
};

// ===== PUBLIC (customer app) =====

export const getCmsPageBySlug = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { slug } = req.params;
    const page = await CmsPage.findOne({
      slug: slugify(slug),
      status: "published",
    });
    if (!page) throw new AppError("Page not found", 404);
    res.json({
      success: true,
      data: {
        slug: page.slug,
        title: page.title,
        description: page.description,
        body: page.body,
        updatedAt: page.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};
