// src/store/images.ts — image assignments, their renditions, and merchant readiness.
//
// An image row is an ASSIGNMENT (this vendor URL shows this part, decided by this method with
// this confidence); the bytes arrive later as variants. Rules:
//   * (part, role, source_url) is the identity. A repeat upsert fills NULL metadata and takes a
//     higher confidence with its method; it never lowers confidence or blanks a licence note.
//   * the 'original' variant mirrors its dimensions onto the images row (storage_path, width,
//     height, bytes, format, sha256), which is what "downloaded" means in the schema comment.
//   * merchant readiness is recorded with its reasons, never by hiding the image: an image that
//     is 600 px stays on record with ["below-800px"] so the gap is visible and fixable.
import { getPool } from "./db.js";
import type { Queryable } from "./runs.js";

export type ImageInput = {
  role?: string;                  // primary | gallery | series
  source_url: string;
  doc_id?: string | null;
  assignment_method: string;      // caption-sku | caption-formfactor | product-figure | series | placeholder
  confidence?: number | null;
  license_note?: string | null;
  source_id?: number | null;
};

export type ImageVariantInput = {
  storage_path: string;
  width: number;
  height: number;
  bytes: number;
  format: string;
  sha256: string;
  background?: string | null;     // white | transparent | other
};

export async function upsertImage(partId: number, input: ImageInput, runId: number, db: Queryable = getPool()): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO images (part_id, role, source_url, doc_id, assignment_method, confidence, license_note, source_id, run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (part_id, role, source_url) DO UPDATE SET
       doc_id            = COALESCE(images.doc_id, EXCLUDED.doc_id),
       assignment_method = CASE WHEN EXCLUDED.confidence IS NOT NULL AND (images.confidence IS NULL OR EXCLUDED.confidence > images.confidence)
                                THEN EXCLUDED.assignment_method ELSE images.assignment_method END,
       confidence        = GREATEST(images.confidence, EXCLUDED.confidence),
       license_note      = COALESCE(images.license_note, EXCLUDED.license_note),
       source_id         = COALESCE(images.source_id, EXCLUDED.source_id)
     RETURNING id`,
    [partId, input.role ?? "primary", input.source_url, input.doc_id ?? null, input.assignment_method, input.confidence ?? null,
      input.license_note ?? null, input.source_id ?? null, runId],
  );
  return r.rows[0].id;
}

export async function setImageVariant(imageId: number, variant: string, v: ImageVariantInput, db: Queryable = getPool()): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO image_variants (image_id, variant, storage_path, width, height, bytes, format, sha256, background)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (image_id, variant) DO UPDATE SET
       storage_path = EXCLUDED.storage_path, width = EXCLUDED.width, height = EXCLUDED.height, bytes = EXCLUDED.bytes,
       format = EXCLUDED.format, sha256 = EXCLUDED.sha256, background = EXCLUDED.background
     RETURNING id`,
    [imageId, variant, v.storage_path, v.width, v.height, v.bytes, v.format, v.sha256, v.background ?? null],
  );
  if (variant === "original") {
    await db.query(
      "UPDATE images SET storage_path = $2, width = $3, height = $4, bytes = $5, format = $6, sha256 = $7 WHERE id = $1",
      [imageId, v.storage_path, v.width, v.height, v.bytes, v.format, v.sha256],
    );
  }
  return r.rows[0].id;
}

export async function setMerchantReadiness(imageId: number, ready: boolean, issues: string[], db: Queryable = getPool()): Promise<void> {
  if (ready && issues.length) throw new Error(`setMerchantReadiness: image ${imageId} cannot be ready with issues [${issues.join(", ")}]`);
  const r = await db.query("UPDATE images SET merchant_ready = $2, merchant_issues = $3::jsonb WHERE id = $1",
    [imageId, ready, JSON.stringify(issues)]);
  if (r.rowCount === 0) throw new Error(`setMerchantReadiness: image ${imageId} does not exist`);
}
