import { body, param, query } from "express-validator";

export const loginValidation = [
  body("email").isEmail().withMessage("Please provide a valid email"),
  body("password").notEmpty().withMessage("Password is required"),
];

export const createSubAdminValidation = [
  body("name").notEmpty().withMessage("Name is required").trim(),
  body("email").isEmail().withMessage("Please provide a valid email"),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  body("permissions")
    .optional()
    .isArray()
    .withMessage("Permissions must be an array"),
];

export const createVendorValidation = [
  body("name").notEmpty().withMessage("Vendor name is required").trim(),
  body("mobile")
    .notEmpty()
    .withMessage("Mobile number is required")
    .matches(/^[0-9]{10}$/)
    .withMessage("Please provide a valid 10-digit mobile number"),
  body("email").isEmail().withMessage("Please provide a valid email"),
  body("business.name")
    .notEmpty()
    .withMessage("Business name is required")
    .trim(),
  body("business.address")
    .notEmpty()
    .withMessage("Business address is required")
    .trim(),
  body("business.gstNumber").optional().trim(),
];

export const createMaterialValidation = [
  body("name").notEmpty().withMessage("Material name is required").trim(),
  body("category").notEmpty().withMessage("Category is required").trim(),
  body("unit").notEmpty().withMessage("Unit is required").trim(),
  body("price")
    .isNumeric()
    .withMessage("Price must be a number")
    .custom((value) => value >= 0)
    .withMessage("Price cannot be negative"),
  body("vendor").isMongoId().withMessage("Please provide a valid vendor ID"),
  body("stock")
    .optional()
    .isNumeric()
    .withMessage("Stock must be a number")
    .custom((value) => value >= 0)
    .withMessage("Stock cannot be negative"),
];

export const idParamValidation = [
  param("id").isMongoId().withMessage("Invalid ID format"),
];

export const paginationValidation = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100"),
];
