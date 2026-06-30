import { S3Client, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import multer from "multer";
import multerS3 from "multer-s3";
import { randomUUID } from "crypto";
import path from "path";
const uuidv4 = randomUUID;

// Initialize S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || "";

// Allowed file types
const allowedMimeTypes = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
];

// File filter
const fileFilter = (
  req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.",
      ),
    );
  }
};

// Create S3 storage with configurable folder
const createS3Storage = (folder: string = "uploads") => {
  return multerS3({
    s3: s3Client,
    bucket: BUCKET_NAME,
    acl: "public-read",
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (
      req: any,
      file: Express.Multer.File,
      cb: (error: any, key?: string) => void,
    ) => {
      const uniqueId = uuidv4();
      const extension = path.extname(file.originalname);
      const fileName = `${folder}/${uniqueId}${extension}`;
      cb(null, fileName);
    },
  });
};

// Default upload middleware (for categories)
export const upload = multer({
  storage: createS3Storage("categories"),
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit (was 5MB — larger logos failed)
  },
});

// Factory function to create upload middleware for specific folder
export const createUpload = (
  folder: string,
  maxSize: number = 5 * 1024 * 1024,
) => {
  return multer({
    storage: createS3Storage(folder),
    fileFilter: fileFilter,
    limits: {
      fileSize: maxSize,
    },
  });
};

// File filter allowing PDF documents (used for uploaded paperwork like quotations)
const pdfFileFilter = (
  req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  if (file.mimetype === "application/pdf") {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only PDF files are allowed."));
  }
};

// Factory function to create a PDF upload middleware for a specific folder
export const createPdfUpload = (
  folder: string,
  maxSize: number = 10 * 1024 * 1024,
) => {
  return multer({
    storage: createS3Storage(folder),
    fileFilter: pdfFileFilter,
    limits: {
      fileSize: maxSize,
    },
  });
};

// Delete file from S3
export const deleteFromS3 = async (fileUrl: string): Promise<boolean> => {
  try {
    if (!fileUrl) return false;

    // Extract key from URL
    const urlParts = fileUrl.split("/");
    const key = urlParts.slice(3).join("/"); // Get path after bucket name

    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error("Error deleting file from S3:", error);
    return false;
  }
};

// Get S3 URL
export const getS3Url = (key: string): string => {
  return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || "ap-south-1"}.amazonaws.com/${key}`;
};

// Upload a Buffer to S3 and return the public URL
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

export const uploadBufferToS3 = async (
  buffer: Buffer,
  folder: string,
  contentType: string,
): Promise<string> => {
  const ext = EXT_BY_CONTENT_TYPE[contentType] || ".jpg";
  const key = `${folder}/${uuidv4()}${ext}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read',
    }),
  );

  const region = process.env.AWS_REGION || 'ap-south-1';
  return `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`;
};

export { s3Client, BUCKET_NAME };
