import { Response, NextFunction } from "express";
import mongoose from "mongoose";
import Driver from "../models/Driver.model";
import { AuthRequest } from "../types";
import { AppError } from "../middlewares/errorHandler";

// Driver-owned document keys (lives on driver.documents)
const DRIVER_DOCUMENT_KEYS = ["drivingLicense"] as const;
type DriverDocumentKey = (typeof DRIVER_DOCUMENT_KEYS)[number];
const isDriverDocumentKey = (value: string): value is DriverDocumentKey =>
  (DRIVER_DOCUMENT_KEYS as readonly string[]).includes(value);

// Vehicle-owned document keys (lives on driver.vehicles[].documents)
const VEHICLE_DOCUMENT_KEYS = [
  "rcBook",
  "insurance",
  "pollutionCertificate",
] as const;
type VehicleDocumentKey = (typeof VEHICLE_DOCUMENT_KEYS)[number];
const isVehicleDocumentKey = (value: string): value is VehicleDocumentKey =>
  (VEHICLE_DOCUMENT_KEYS as readonly string[]).includes(value);

// Get all drivers (with pagination and filters)
export const getDrivers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status,
      approvalStatus,
      isVerified,
      city,
      state,
      fromDate,
      toDate,
      showDeleted = "false",
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: any = {};

    if (showDeleted === "true") {
      query.isDeleted = true;
    } else {
      query.isDeleted = false;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { "vehicles.registrationNo": { $regex: search, $options: "i" } },
      ];
    }

    if (
      status &&
      ["active", "inactive", "blocked"].includes(status as string)
    ) {
      query.status = status;
    }

    if (
      approvalStatus &&
      ["pending", "approved", "rejected"].includes(approvalStatus as string)
    ) {
      query.approvalStatus = approvalStatus;
    }

    if (isVerified === "true") {
      query.isVerified = true;
    } else if (isVerified === "false") {
      query.isVerified = false;
    }

    if (city) query["address.city"] = { $regex: city, $options: "i" };
    if (state) query["address.state"] = { $regex: state, $options: "i" };

    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate as string);
      if (toDate) {
        const endDate = new Date(toDate as string);
        endDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDate;
      }
    }

    const [drivers, total] = await Promise.all([
      Driver.find(query)
        .populate("updatedBy", "name email")
        .populate("deletedBy", "name email")
        .populate("approvedBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Driver.countDocuments(query),
    ]);

    const stats = await Driver.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          inactive: {
            $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] },
          },
          blocked: { $sum: { $cond: [{ $eq: ["$status", "blocked"] }, 1, 0] } },
          pending: {
            $sum: { $cond: [{ $eq: ["$approvalStatus", "pending"] }, 1, 0] },
          },
          approved: {
            $sum: { $cond: [{ $eq: ["$approvalStatus", "approved"] }, 1, 0] },
          },
          rejected: {
            $sum: { $cond: [{ $eq: ["$approvalStatus", "rejected"] }, 1, 0] },
          },
          verified: { $sum: { $cond: ["$isVerified", 1, 0] } },
        },
      },
    ]);

    res.json({
      success: true,
      data: drivers,
      stats: stats[0] || {
        total: 0,
        active: 0,
        inactive: 0,
        blocked: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        verified: 0,
      },
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

// Get single driver by ID
export const getDriver = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const driver = await Driver.findById(id)
      .populate("updatedBy", "name email")
      .populate("deletedBy", "name email")
      .populate("approvedBy", "name email");

    if (!driver) throw new AppError("Driver not found", 404);

    res.json({ success: true, data: driver });
  } catch (error) {
    next(error);
  }
};

// Update driver (mobile cannot be changed)
export const updateDriver = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, email, dateOfBirth, address, owner, bank, status } =
      req.body;

    const driver = await Driver.findById(id);
    if (!driver) throw new AppError("Driver not found", 404);
    if (driver.isDeleted)
      throw new AppError("Cannot update a deleted driver", 400);

    if (name !== undefined) driver.name = name;
    if (email !== undefined) driver.email = email || undefined;
    if (dateOfBirth !== undefined)
      driver.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : undefined;
    if (status) driver.status = status;

    if (address) {
      driver.address = {
        street: address.street ?? driver.address?.street,
        city: address.city ?? driver.address?.city,
        state: address.state ?? driver.address?.state,
        pincode: address.pincode ?? driver.address?.pincode,
        full: address.full ?? driver.address?.full,
        location: driver.address?.location,
      };
    }

    if (owner) {
      driver.owner = { ...(driver.owner || {}), ...owner };
    }
    if (bank) {
      driver.bank = { ...(driver.bank || {}), ...bank };
    }

    driver.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await driver.save();

    const updated = await Driver.findById(id)
      .populate("updatedBy", "name email")
      .populate("approvedBy", "name email");

    res.json({
      success: true,
      message: "Driver updated successfully",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete
export const deleteDriver = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const driver = await Driver.findById(id);
    if (!driver) throw new AppError("Driver not found", 404);
    if (driver.isDeleted) throw new AppError("Driver is already deleted", 400);

    driver.isDeleted = true;
    driver.deletedAt = new Date();
    driver.deletedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await driver.save();

    res.json({ success: true, message: "Driver deleted successfully" });
  } catch (error) {
    next(error);
  }
};

// Restore
export const restoreDriver = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const driver = await Driver.findById(id);
    if (!driver) throw new AppError("Driver not found", 404);
    if (!driver.isDeleted) throw new AppError("Driver is not deleted", 400);

    driver.isDeleted = false;
    driver.deletedAt = undefined;
    driver.deletedBy = undefined;
    driver.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await driver.save();

    const restored = await Driver.findById(id).populate(
      "updatedBy",
      "name email",
    );

    res.json({
      success: true,
      message: "Driver restored successfully",
      data: restored,
    });
  } catch (error) {
    next(error);
  }
};

// Permanent delete
export const permanentDeleteDriver = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const driver = await Driver.findById(id);
    if (!driver) throw new AppError("Driver not found", 404);

    await Driver.findByIdAndDelete(id);

    res.json({ success: true, message: "Driver permanently deleted" });
  } catch (error) {
    next(error);
  }
};

// Toggle status
export const toggleDriverStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const driver = await Driver.findById(id);
    if (!driver) throw new AppError("Driver not found", 404);
    if (driver.isDeleted)
      throw new AppError("Cannot change status of a deleted driver", 400);

    if (status && ["active", "inactive", "blocked"].includes(status)) {
      driver.status = status;
    } else {
      driver.status = driver.status === "active" ? "blocked" : "active";
    }

    driver.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await driver.save();

    const updated = await Driver.findById(id).populate(
      "updatedBy",
      "name email",
    );

    res.json({
      success: true,
      message: `Driver ${driver.status} successfully`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// Approve driver (whole-driver approval)
export const approveDriver = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const driver = await Driver.findById(id);
    if (!driver) throw new AppError("Driver not found", 404);
    if (driver.isDeleted)
      throw new AppError("Cannot approve a deleted driver", 400);

    driver.approvalStatus = "approved";
    driver.approvedAt = new Date();
    driver.approvedBy = new mongoose.Types.ObjectId(req.admin!._id);
    driver.rejectionReason = undefined;

    // When approving the driver, mark all uploaded docs as approved too —
    // both driver-owned (license) and vehicle-owned (RC/insurance/pollution).
    DRIVER_DOCUMENT_KEYS.forEach((key) => {
      const doc = driver.documents?.[key];
      if (doc?.url && doc.status !== "approved") {
        doc.status = "approved";
        doc.rejectionReason = undefined;
      }
    });
    driver.vehicles.forEach((v) => {
      VEHICLE_DOCUMENT_KEYS.forEach((key) => {
        const doc = v.documents?.[key];
        if (doc?.url && doc.status !== "approved") {
          doc.status = "approved";
          doc.rejectionReason = undefined;
        }
      });
    });

    driver.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await driver.save();

    const updated = await Driver.findById(id)
      .populate("updatedBy", "name email")
      .populate("approvedBy", "name email");

    res.json({
      success: true,
      message: "Driver approved successfully",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// Reject whole driver
export const rejectDriver = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const driver = await Driver.findById(id);
    if (!driver) throw new AppError("Driver not found", 404);
    if (driver.isDeleted)
      throw new AppError("Cannot reject a deleted driver", 400);

    driver.approvalStatus = "rejected";
    driver.rejectionReason = reason || "Rejected by admin";
    driver.approvedAt = undefined;
    driver.approvedBy = undefined;
    driver.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await driver.save();

    const updated = await Driver.findById(id).populate(
      "updatedBy",
      "name email",
    );

    res.json({
      success: true,
      message: "Driver rejected",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// Reject a driver-owned document (driving license) — driver must re-upload.
export const rejectDocument = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id, docType } = req.params;
    const { reason } = req.body;

    if (!isDriverDocumentKey(docType)) {
      throw new AppError(
        `Invalid document type. Allowed: ${DRIVER_DOCUMENT_KEYS.join(", ")}`,
        400,
      );
    }

    const driver = await Driver.findById(id);
    if (!driver) throw new AppError("Driver not found", 404);
    if (driver.isDeleted) throw new AppError("Driver is deleted", 400);

    const doc = driver.documents[docType];
    if (!doc?.url) {
      throw new AppError("Document not uploaded yet", 400);
    }

    doc.status = "rejected";
    doc.rejectionReason = reason || "Document rejected. Please re-upload.";

    driver.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await driver.save();

    const updated = await Driver.findById(id).populate(
      "updatedBy",
      "name email",
    );

    res.json({
      success: true,
      message: `Document ${docType} rejected`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// Approve a driver-owned document
export const approveDocument = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id, docType } = req.params;

    if (!isDriverDocumentKey(docType)) {
      throw new AppError(
        `Invalid document type. Allowed: ${DRIVER_DOCUMENT_KEYS.join(", ")}`,
        400,
      );
    }

    const driver = await Driver.findById(id);
    if (!driver) throw new AppError("Driver not found", 404);
    if (driver.isDeleted) throw new AppError("Driver is deleted", 400);

    const doc = driver.documents[docType];
    if (!doc?.url) {
      throw new AppError("Document not uploaded yet", 400);
    }

    doc.status = "approved";
    doc.rejectionReason = undefined;

    driver.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await driver.save();

    const updated = await Driver.findById(id).populate(
      "updatedBy",
      "name email",
    );

    res.json({
      success: true,
      message: `Document ${docType} approved`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// Approve / reject a vehicle-owned document (RC / insurance / pollution).
const updateVehicleDocStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  newStatus: "approved" | "rejected",
): Promise<void> => {
  try {
    const { id, vehicleId, docType } = req.params;
    const { reason } = req.body;

    if (!isVehicleDocumentKey(docType)) {
      throw new AppError(
        `Invalid vehicle document type. Allowed: ${VEHICLE_DOCUMENT_KEYS.join(", ")}`,
        400,
      );
    }

    const driver = await Driver.findById(id);
    if (!driver) throw new AppError("Driver not found", 404);
    if (driver.isDeleted) throw new AppError("Driver is deleted", 400);

    const vehicle = (driver.vehicles as any).id(vehicleId);
    if (!vehicle) throw new AppError("Vehicle not found", 404);

    const doc = vehicle.documents?.[docType];
    if (!doc?.url) {
      throw new AppError("Document not uploaded yet", 400);
    }

    doc.status = newStatus;
    doc.rejectionReason =
      newStatus === "rejected"
        ? reason || "Document rejected. Please re-upload."
        : undefined;

    driver.updatedBy = new mongoose.Types.ObjectId(req.admin!._id);
    await driver.save();

    const updated = await Driver.findById(id).populate(
      "updatedBy",
      "name email",
    );

    res.json({
      success: true,
      message: `Vehicle document ${docType} ${newStatus}`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

export const approveVehicleDocument = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => updateVehicleDocStatus(req, res, next, "approved");

export const rejectVehicleDocument = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => updateVehicleDocStatus(req, res, next, "rejected");

// Stats endpoint
export const getDriverStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const overview = await Driver.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          inactive: {
            $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] },
          },
          blocked: { $sum: { $cond: [{ $eq: ["$status", "blocked"] }, 1, 0] } },
          pending: {
            $sum: { $cond: [{ $eq: ["$approvalStatus", "pending"] }, 1, 0] },
          },
          approved: {
            $sum: { $cond: [{ $eq: ["$approvalStatus", "approved"] }, 1, 0] },
          },
          rejected: {
            $sum: { $cond: [{ $eq: ["$approvalStatus", "rejected"] }, 1, 0] },
          },
          verified: { $sum: { $cond: ["$isVerified", 1, 0] } },
        },
      },
    ]);

    const byCity = await Driver.aggregate([
      {
        $match: {
          isDeleted: false,
          "address.city": { $exists: true, $ne: "" },
        },
      },
      { $group: { _id: "$address.city", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    const byState = await Driver.aggregate([
      {
        $match: {
          isDeleted: false,
          "address.state": { $exists: true, $ne: "" },
        },
      },
      { $group: { _id: "$address.state", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentRegistrations = await Driver.countDocuments({
      isDeleted: false,
      createdAt: { $gte: sevenDaysAgo },
    });

    res.json({
      success: true,
      data: {
        overview: overview[0] || {
          total: 0,
          active: 0,
          inactive: 0,
          blocked: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
          verified: 0,
        },
        byCity,
        byState,
        recentRegistrations,
      },
    });
  } catch (error) {
    next(error);
  }
};
