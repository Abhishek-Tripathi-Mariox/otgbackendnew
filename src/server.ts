import dotenv from "dotenv";
dotenv.config();

import express, { Application } from "express";
import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import cors from "cors";
import { connectDB } from "./config/database";
import { errorHandler } from "./middlewares/errorHandler";
import authRoutes from "./routes/auth.routes";
import adminRoutes from "./routes/admin.routes";
import vendorRoutes from "./routes/vendor.routes";
import materialRoutes from "./routes/material.routes";
import categoryRoutes from "./routes/category.routes";
import brandRoutes from "./routes/brand.routes";
import subCategoryRoutes from "./routes/subCategory.routes";
import userRoutes from "./routes/user.routes";
import driverRoutes from "./routes/driver.routes";
import driverMobileRoutes from "./routes/driverMobile.routes";
import mobileAuthRoutes from "./routes/mobileAuth.routes";
import vendorAuthRoutes from "./routes/vendorAuth.routes";
import vendorOrdersRoutes from "./routes/vendorOrders.routes";
import vendorInventoryRoutes from "./routes/vendorInventory.routes";
import mobileCatalogRoutes from "./routes/mobileCatalog.routes";
import mobileOrdersRoutes from "./routes/mobileOrders.routes";
import bookingRoutes from "./routes/booking.routes";
import staffRoutes from "./routes/staff.routes";
import roleRoutes from "./routes/role.routes";
import configRoutes from "./routes/config.routes";
import notificationRoutes from "./routes/notification.routes";
import bannerRoutes from "./routes/banner.routes";
import sellerRequestRoutes from "./routes/sellerRequest.routes";
import cmsPageRoutes from "./routes/cmsPage.routes";
import quotationRoutes from "./routes/quotation.routes";
import offerRoutes from "./routes/offer.routes";
import mobileOffersRoutes from "./routes/mobileOffers.routes";
import helpRoutes from "./routes/help.routes";
import appSettingsRoutes from "./routes/appSettings.routes";
import transactionRoutes from "./routes/transaction.routes";
import reviewRoutes from "./routes/review.routes";
import faqRoutes from "./routes/faq.routes";
import { seedAdmin } from "./config/seed";

const app: Application = express();
const PORT = process.env.PORT || 5011;
const USE_HTTPS = process.env.USE_HTTPS === "true";

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/materials", materialRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/brands", brandRoutes);
app.use("/api/sub-categories", subCategoryRoutes);
app.use("/api/users", userRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/mobile/driver", driverMobileRoutes);
app.use("/api/mobile/auth", mobileAuthRoutes);
app.use("/api/vendor/auth", vendorAuthRoutes);
app.use("/api/vendor/orders", vendorOrdersRoutes);
app.use("/api/vendor/inventory", vendorInventoryRoutes);
app.use("/api/mobile/catalog", mobileCatalogRoutes);
app.use("/api/mobile/orders", mobileOrdersRoutes);
app.use("/api/mobile/offers", mobileOffersRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/config", configRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/banners", bannerRoutes);
app.use("/api/seller-requests", sellerRequestRoutes);
app.use("/api/cms-pages", cmsPageRoutes);
app.use("/api/quotations", quotationRoutes);
app.use("/api/help", helpRoutes);
app.use("/api/app-settings", appSettingsRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/faqs", faqRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Server is running" });
});

// Error Handler
app.use(errorHandler);

// Connect to Database and Start Server
const startServer = async () => {
  try {
    await connectDB();
    await seedAdmin();

    if (USE_HTTPS) {
      // SSL Certificate paths from environment variables
      const sslKeyPath =
        process.env.SSL_KEY_PATH || "/etc/ssl/private/server.key";
      const sslCertPath =
        process.env.SSL_CERT_PATH || "/etc/ssl/certs/server.crt";

      // Check if SSL files exist
      if (!fs.existsSync(sslKeyPath) || !fs.existsSync(sslCertPath)) {
        console.error("SSL certificate files not found!");
        console.error(`Key path: ${sslKeyPath}`);
        console.error(`Cert path: ${sslCertPath}`);
        console.log("Falling back to HTTP...");

        app.listen(PORT, () => {
          console.log(`HTTP Server is running on port ${PORT}`);
        });
        return;
      }

      const httpsOptions = {
        key: fs.readFileSync(sslKeyPath),
        cert: fs.readFileSync(sslCertPath),
      };

      https.createServer(httpsOptions, app).listen(PORT, () => {
        console.log(`HTTPS Server is running on port ${PORT}`);
        console.log(`Access: https://<your-ip>:${PORT}`);
      });
    } else {
      app.listen(PORT, () => {
        console.log(`HTTP Server is running on port ${PORT}`);
      });
    }
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
