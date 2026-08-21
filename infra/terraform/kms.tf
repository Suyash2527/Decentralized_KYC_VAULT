# ---------------------------------------------------------------------------
# Key hierarchy
#
#   pii-kek          symmetric, HSM, 90d rotation
#                    -> wraps a fresh per-record DEK. Never sees plaintext PII.
#   operator-signing asymmetric EC_SIGN_SECP256K1_SHA256, HSM
#                    -> the Ethereum operator private key. Generated inside the
#                       HSM, non-exportable. There is no plaintext copy anywhere.
#   sql-cmek         symmetric, HSM -> Cloud SQL data, backups and WAL at rest.
#   secrets-cmek     symmetric, HSM -> Secret Manager payloads at rest.
#
# Separate keys per purpose so that a single IAM mistake cannot cross domains,
# and so key-usage audit logs are attributable to one system each.
# ---------------------------------------------------------------------------

resource "google_kms_key_ring" "main" {
  name     = "${local.prefix}-keyring"
  location = var.region

  depends_on = [google_project_service.required]
}

# --- PII key-encryption key -------------------------------------------------
resource "google_kms_crypto_key" "pii_kek" {
  name     = "pii-kek"
  key_ring = google_kms_key_ring.main.id
  purpose  = "ENCRYPT_DECRYPT"

  rotation_period = var.key_rotation_period

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = var.kms_protection_level
  }

  # A destroyed KEK is unrecoverable PII loss. 30 days of scheduled-destroy
  # gives an operator time to notice and restore.
  destroy_scheduled_duration = "2592000s"

  labels = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

# --- Ethereum operator signing key -----------------------------------------
# secp256k1 is only available at HSM protection level in some regions; if
# terraform reports the algorithm is unsupported, check region availability.
resource "google_kms_crypto_key" "operator_signing" {
  name     = "operator-signing"
  key_ring = google_kms_key_ring.main.id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm        = "EC_SIGN_SECP256K1_SHA256"
    protection_level = var.kms_protection_level
  }

  destroy_scheduled_duration = "2592000s"

  labels = local.labels

  lifecycle {
    # Losing this key means losing control of the contract's operator role.
    prevent_destroy = true
  }
}

# Asymmetric keys are not auto-rotated: rotating changes the derived Ethereum
# address, which requires a contract-side operator handover. Rotation is a
# deliberate, documented procedure (see docs/KMS_RUNBOOK.md), not a schedule.

# --- CMEK for Cloud SQL -----------------------------------------------------
resource "google_kms_crypto_key" "sql_cmek" {
  name            = "sql-cmek"
  key_ring        = google_kms_key_ring.main.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = var.key_rotation_period

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = var.kms_protection_level
  }

  destroy_scheduled_duration = "2592000s"
  labels                     = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

# --- CMEK for Secret Manager ------------------------------------------------
resource "google_kms_crypto_key" "secrets_cmek" {
  name            = "secrets-cmek"
  key_ring        = google_kms_key_ring.main.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = var.key_rotation_period

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = var.kms_protection_level
  }

  destroy_scheduled_duration = "2592000s"
  labels                     = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Key IAM - deliberately narrow.
#
# The backend can wrap and unwrap DEKs, and can ask the signing key to sign.
# It cannot read the signing key's private material (no such permission exists
# for HSM keys), cannot create or destroy key versions, and cannot touch the
# CMEK keys used by Cloud SQL and Secret Manager.
# ---------------------------------------------------------------------------

resource "google_kms_crypto_key_iam_member" "backend_pii_kek" {
  crypto_key_id = google_kms_crypto_key.pii_kek.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_kms_crypto_key_iam_member" "backend_signer" {
  crypto_key_id = google_kms_crypto_key.operator_signing.id
  role          = "roles/cloudkms.signerVerifier"
  member        = "serviceAccount:${google_service_account.backend.email}"
}

# Needed to fetch the public key once at boot in order to derive the operator's
# Ethereum address. Read-only on metadata; grants no signing power on its own.
resource "google_kms_crypto_key_iam_member" "backend_signer_viewer" {
  crypto_key_id = google_kms_crypto_key.operator_signing.id
  role          = "roles/cloudkms.publicKeyViewer"
  member        = "serviceAccount:${google_service_account.backend.email}"
}

# Cloud SQL's Google-managed service agent must be able to use the CMEK key,
# otherwise instance creation fails with a generic permission error.
resource "google_kms_crypto_key_iam_member" "sql_agent_cmek" {
  crypto_key_id = google_kms_crypto_key.sql_cmek.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${local.sql_service_agent}"

  depends_on = [google_project_service_identity.sql]
}

resource "google_kms_crypto_key_iam_member" "secretmanager_agent_cmek" {
  crypto_key_id = google_kms_crypto_key.secrets_cmek.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${local.secret_service_agent}"

  depends_on = [google_project_service_identity.secretmanager]
}

# Service agents are created lazily; force them to exist before we grant on them.
resource "google_project_service_identity" "sql" {
  provider = google-beta
  project  = var.project_id
  service  = "sqladmin.googleapis.com"

  depends_on = [google_project_service.required]
}

resource "google_project_service_identity" "secretmanager" {
  provider = google-beta
  project  = var.project_id
  service  = "secretmanager.googleapis.com"

  depends_on = [google_project_service.required]
}
