-- SukatAI XAMPP schema.
-- Import this file in phpMyAdmin before opening the application.

CREATE DATABASE IF NOT EXISTS `sukatai`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `sukatai`;

CREATE TABLE IF NOT EXISTS `users` (
  `id` CHAR(36) NOT NULL,
  `role` VARCHAR(20) NOT NULL DEFAULT 'customer',
  `organization_id` CHAR(36) NULL,
  `first_name` VARCHAR(80) NOT NULL,
  `last_name` VARCHAR(80) NOT NULL,
  `email` VARCHAR(320) NOT NULL,
  `phone` VARCHAR(32) NULL,
  `email_notifications` TINYINT(1) NOT NULL DEFAULT 1,
  `sms_notifications` TINYINT(1) NOT NULL DEFAULT 0,
  `password_hash` VARCHAR(255) NOT NULL,
  `avatar_url` VARCHAR(500) NULL,
  `unit_system` VARCHAR(10) NOT NULL DEFAULT 'cm',
  `reset_token_hash` CHAR(64) NULL,
  `reset_expires_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_unique` (`email`),
  KEY `users_org_idx` (`organization_id`),
  KEY `users_role_idx` (`role`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `organizations` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `owner_id` CHAR(36) NOT NULL,
  `settings` JSON NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `organizations_owner_idx` (`owner_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `dressmaker_invitations` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `email` VARCHAR(320) NOT NULL,
  `invited_role` VARCHAR(20) NOT NULL DEFAULT 'dressmaker',
  `token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `accepted_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `invited_by` CHAR(36) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `invitations_token_unique` (`token_hash`),
  KEY `invitations_org_status_idx` (`organization_id`, `accepted_at`, `revoked_at`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `scans` (
  `id` CHAR(36) NOT NULL,
  `customer_id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'draft',
  `height_value` DECIMAL(6,2) NULL,
  `height_unit` VARCHAR(10) NOT NULL DEFAULT 'cm',
  `consent_at` DATETIME NULL,
  `capture_source` VARCHAR(10) NOT NULL DEFAULT 'upload',
  `processing_provider` VARCHAR(120) NULL,
  `processing_version` VARCHAR(120) NULL,
  `failure_reason` VARCHAR(1000) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `scans_customer_status_idx` (`customer_id`, `status`, `updated_at`),
  KEY `scans_org_status_idx` (`organization_id`, `status`, `updated_at`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `scan_assets` (
  `id` CHAR(36) NOT NULL,
  `scan_id` CHAR(36) NOT NULL,
  `asset_type` VARCHAR(30) NOT NULL,
  `storage_path` VARCHAR(500) NOT NULL,
  `metadata` JSON NOT NULL,
  `quality_status` VARCHAR(30) NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `scan_assets_scan_type_unique` (`scan_id`, `asset_type`),
  KEY `scan_assets_scan_idx` (`scan_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `body_models` (
  `id` CHAR(36) NOT NULL,
  `scan_id` CHAR(36) NOT NULL,
  `provider` VARCHAR(120) NOT NULL,
  `model_url_or_path` VARCHAR(500) NULL,
  `preview_data` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'queued',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `body_models_scan_unique` (`scan_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `measurements` (
  `id` CHAR(36) NOT NULL,
  `scan_id` CHAR(36) NOT NULL,
  `key` VARCHAR(80) NOT NULL,
  `value` DECIMAL(8,2) NOT NULL,
  `unit` VARCHAR(5) NOT NULL DEFAULT 'cm',
  `confidence` DECIMAL(5,2) NULL,
  `ai_value` DECIMAL(8,2) NULL,
  `adjusted_value` DECIMAL(8,2) NULL,
  `adjusted_by` CHAR(36) NULL,
  `adjustment_reason` VARCHAR(1000) NULL,
  `verified_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `measurements_scan_key_unique` (`scan_id`, `key`),
  KEY `measurements_scan_idx` (`scan_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `measurement_review_events` (
  `id` CHAR(36) NOT NULL,
  `scan_id` CHAR(36) NOT NULL,
  `actor_id` CHAR(36) NOT NULL,
  `event_type` VARCHAR(40) NOT NULL,
  `payload` JSON NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `review_events_scan_idx` (`scan_id`, `created_at`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `orders` (
  `id` CHAR(36) NOT NULL,
  `customer_id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NULL,
  `dressmaker_id` CHAR(36) NULL,
  `scan_id` CHAR(36) NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'new',
  `garment_type` VARCHAR(120) NOT NULL,
  `due_date` DATE NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `orders_customer_idx` (`customer_id`, `created_at`),
  KEY `orders_org_status_idx` (`organization_id`, `status`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `fittings` (
  `id` CHAR(36) NOT NULL,
  `order_id` CHAR(36) NOT NULL,
  `starts_at` DATETIME NOT NULL,
  `location` VARCHAR(500) NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'requested',
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fittings_order_idx` (`order_id`, `starts_at`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `type` VARCHAR(80) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `body` VARCHAR(1000) NOT NULL,
  `read_at` DATETIME NULL,
  `metadata` JSON NOT NULL,
  `event_key` VARCHAR(180) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `notifications_event_key_unique` (`event_key`),
  KEY `notifications_user_idx` (`user_id`, `read_at`, `created_at`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `notification_deliveries` (
  `id` CHAR(36) NOT NULL,
  `notification_id` CHAR(36) NULL,
  `user_id` CHAR(36) NULL,
  `event_key` VARCHAR(180) NOT NULL,
  `channel` VARCHAR(20) NOT NULL,
  `destination` VARCHAR(320) NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'pending',
  `provider` VARCHAR(40) NOT NULL DEFAULT 'console',
  `provider_message_id` VARCHAR(255) NULL,
  `error` VARCHAR(1000) NULL,
  `sent_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `notification_deliveries_event_channel_unique` (`event_key`, `channel`),
  KEY `notification_deliveries_user_idx` (`user_id`, `created_at`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_hash),
  KEY sessions_user_idx (user_id),
  KEY sessions_expiry_idx (expires_at)
) ENGINE=InnoDB;

-- Create a customer account in the app first, then promote it if you need the admin console:
-- UPDATE users SET role = 'admin' WHERE email = 'your-admin-email@example.com';
