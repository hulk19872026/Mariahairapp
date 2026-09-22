import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Where photo bytes actually live.
 *
 * Two drivers, picked by what's in the environment:
 *
 *   r2    — Cloudflare R2, used as soon as R2_BUCKET (or S3_BUCKET) is set.
 *           The same code also talks to Backblaze B2, AWS S3 or MinIO; R2 is
 *           just the one this is tuned and documented for.
 *   disk  — the fallback. Writes under UPLOAD_DIR, which on Railway means a
 *           mounted volume. Fine to start with, but not backed up.
 *
 * Nothing is ever served straight from the bucket. Every read goes through
 * /api/photos/[id], which is behind the login — a client's hair photos should
 * not sit on a URL anyone can guess. So the R2 bucket stays private: no public
 * access, no custom domain needed.
 */

export type Stored = { body: Buffer; mime: string };

interface Driver {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Stored | null>;
  del(key: string): Promise<void>;
  name: string;
}

/* ------------------------------------------------------------------ disk -- */

const ROOT = process.env.UPLOAD_DIR || "/data/uploads";

// keys are generated here, never taken from a request, but check anyway
function safeJoin(key: string): string {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(path.resolve(ROOT) + path.sep))
    throw new Error("Bad storage key");
  return full;
}

const diskDriver: Driver = {
  name: "disk",
  async put(key, body) {
    const full = safeJoin(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
  },
  async get(key) {
    try {
      const body = await fs.readFile(safeJoin(key));
      return { body, mime: key.endsWith(".png") ? "image/png" : "image/jpeg" };
    } catch {
      return null;
    }
  },
  async del(key) {
    try {
      await fs.unlink(safeJoin(key));
    } catch {
      /* already gone */
    }
  },
};

/* --------------------------------------------------------- r2 / s3 api -- */

/** R2 names its variables its own way; accept either spelling. */
export const bucketName = () => process.env.R2_BUCKET || process.env.S3_BUCKET || "";

function endpoint(): string | undefined {
  if (process.env.S3_ENDPOINT) return process.env.S3_ENDPOINT;
  const acct = process.env.R2_ACCOUNT_ID;
  return acct ? `https://${acct}.r2.cloudflarestorage.com` : undefined;
}

let s3Client: any = null;
async function s3() {
  if (s3Client) return s3Client;
  const { S3Client } = await import("@aws-sdk/client-s3");

  const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey)
    throw new Error("R2 keys are missing (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY).");

  s3Client = new S3Client({
    // R2 has no regions; "auto" is what it expects.
    region: process.env.R2_REGION || process.env.S3_REGION || "auto",
    endpoint: endpoint(),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId, secretAccessKey },

    // Recent AWS SDK versions attach a CRC32 checksum to every request and
    // demand one back. R2 doesn't always play along, and the failure looks
    // like a baffling 400. Only send checksums when the operation needs them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  } as any);
  return s3Client;
}

const s3Driver: Driver = {
  name: "r2",
  async put(key, body, mime) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3();
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName(),
        Key: key,
        Body: body,
        ContentType: mime,
      })
    );
  },
  async get(key) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3();
    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucketName(), Key: key })
      );
      const body = Buffer.from(await res.Body!.transformToByteArray());
      return { body, mime: res.ContentType || "image/jpeg" };
    } catch {
      return null;
    }
  },
  async del(key) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3();
    try {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucketName(), Key: key })
      );
    } catch {
      /* already gone */
    }
  },
};

/* ----------------------------------------------------------------- pick -- */

export function storage(): Driver {
  return bucketName() ? s3Driver : diskDriver;
}

export function storageName(): string {
  return storage().name;
}

/** photos/<customer>/<random>-full.jpg — grouped so one client is easy to find. */
export function makeKey(customerId: string, variant: "full" | "thumb", ext = "jpg") {
  const id = crypto.randomBytes(8).toString("hex");
  return `photos/${customerId}/${id}-${variant}.${ext}`;
}

/** Confirms the driver can actually be written to, for the Settings screen. */
export async function storageReady(): Promise<boolean> {
  try {
    const key = `photos/_check/${crypto.randomBytes(4).toString("hex")}.jpg`;
    await storage().put(key, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "image/jpeg");
    await storage().del(key);
    return true;
  } catch {
    return false;
  }
}
