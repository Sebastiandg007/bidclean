import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthTables1700000000000 implements MigrationInterface {
  name = 'CreateAuthTables1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Users table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "keycloak_id" VARCHAR(255) NOT NULL,
        "email" VARCHAR(255) NOT NULL,
        "full_name" VARCHAR(255) NOT NULL,
        "country" CHAR(2) NOT NULL,
        "language" VARCHAR(35) NOT NULL DEFAULT 'en',
        "is_email_verified" BOOLEAN DEFAULT FALSE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_keycloak_id"
        ON "users" ("keycloak_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_email"
        ON "users" ("email")
    `);

    // Auth sessions table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auth_sessions" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "keycloak_session_id" VARCHAR(255),
        "device_id" VARCHAR(255) NOT NULL,
        "ip_address" INET,
        "user_agent" TEXT,
        "last_active_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "FK_auth_sessions_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_auth_sessions_user_id"
        ON "auth_sessions" ("user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_auth_sessions_device_id"
        ON "auth_sessions" ("device_id")
    `);

    // Biometric credentials table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "biometric_credentials" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "device_id" VARCHAR(255) NOT NULL,
        "public_key" TEXT NOT NULL,
        "credential_type" VARCHAR(50) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "last_used_at" TIMESTAMP WITH TIME ZONE,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "FK_biometric_credentials_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_biometric_credentials_user_device"
          UNIQUE ("user_id", "device_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_biometric_credentials_user_id"
        ON "biometric_credentials" ("user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_biometric_credentials_device_id"
        ON "biometric_credentials" ("device_id")
    `);

    // Biometric challenges table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "biometric_challenges" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "device_id" VARCHAR(255) NOT NULL,
        "nonce" VARCHAR(255) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "used" BOOLEAN DEFAULT FALSE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_biometric_challenges_device_id"
        ON "biometric_challenges" ("device_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_biometric_challenges_expires_at"
        ON "biometric_challenges" ("expires_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "biometric_challenges"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "biometric_credentials"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
