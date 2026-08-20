import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKycTables1700000002000 implements MigrationInterface {
  name = 'CreateKycTables1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // KYC verifications table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kyc_verifications" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "status" VARCHAR(30) NOT NULL DEFAULT 'NOT_STARTED',
        "attempt_number" INTEGER NOT NULL DEFAULT 1,
        "document_type" VARCHAR(30),
        "document_storage_key" VARCHAR(512),
        "selfie_storage_key" VARCHAR(512),
        "extracted_name" VARCHAR(255),
        "extracted_document_number" VARCHAR(100),
        "extracted_expiry_date" DATE,
        "extracted_document_type" VARCHAR(30),
        "ocr_confidence" NUMERIC(5,4),
        "face_similarity_score" NUMERIC(5,4),
        "liveness_score" NUMERIC(5,4),
        "name_match_score" NUMERIC(5,4),
        "processing_attempts" INTEGER DEFAULT 0,
        "last_processing_error" TEXT,
        "rejection_reason" TEXT,
        "reviewed_by" UUID,
        "reviewed_at" TIMESTAMP WITH TIME ZONE,
        "document_uploaded_at" TIMESTAMP WITH TIME ZONE,
        "selfie_uploaded_at" TIMESTAMP WITH TIME ZONE,
        "processing_started_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "FK_kyc_verifications_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_kyc_verifications_reviewed_by"
          FOREIGN KEY ("reviewed_by") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "uq_kyc_user_attempt"
          UNIQUE ("user_id", "attempt_number"),
        CONSTRAINT "chk_attempt_number"
          CHECK ("attempt_number" > 0)
      )
    `);

    // Indexes for kyc_verifications
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kyc_user_attempt"
        ON "kyc_verifications" ("user_id", "attempt_number" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kyc_verifications_user"
        ON "kyc_verifications" ("user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kyc_verifications_status"
        ON "kyc_verifications" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kyc_verifications_review"
        ON "kyc_verifications" ("status", "created_at")
        WHERE "status" = 'REJECTED' OR "status" = 'PROCESSING'
    `);

    // KYC audit logs table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kyc_audit_logs" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "verification_id" UUID NOT NULL,
        "action" VARCHAR(50) NOT NULL,
        "actor_id" UUID,
        "old_status" VARCHAR(30),
        "new_status" VARCHAR(30),
        "metadata" JSONB,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "FK_kyc_audit_logs_verification_id"
          FOREIGN KEY ("verification_id") REFERENCES "kyc_verifications" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_kyc_audit_logs_actor_id"
          FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    // Indexes for kyc_audit_logs
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kyc_audit_logs_verification"
        ON "kyc_audit_logs" ("verification_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kyc_audit_logs_actor"
        ON "kyc_audit_logs" ("actor_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse order (audit logs depend on verifications)
    await queryRunner.query(`DROP TABLE IF EXISTS "kyc_audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kyc_verifications"`);
  }
}
