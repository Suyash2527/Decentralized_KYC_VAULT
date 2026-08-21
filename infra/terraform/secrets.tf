# ---------------------------------------------------------------------------
# Secret Manager.
#
# What lives here is deliberately short. The two highest-value secrets in the
# old design are gone:
#   ENCRYPTION_KEY       -> replaced by per-record DEKs wrapped by KMS
#   DEPLOYER_PRIVATE_KEY -> replaced by a non-exportable KMS signing key
# What remains are secrets that must reach the process as plaintext to be
# useful at all (a JWT signing secret, shared registration codes, an API key).
# Those are stored under CMEK, versioned, and mounted at request time.
# ---------------------------------------------------------------------------

locals {
  app_secrets = {
    jwt-secret = {
      description = "HS256 signing secret for API session tokens."
      generate    = true
    }
    verifier-registration-code = {
      description = "Authorization code required to register a VERIFIER account."
      generate    = true
    }
    partner-registration-code = {
      description = "Authorization code required to register a PARTNER account."
      generate    = true
    }
    gcp-vision-api-key = {
      description = "Google Cloud Vision API key for OCR document extraction. Populate manually."
      generate    = false
    }
  }
}

resource "google_secret_manager_secret" "app" {
  for_each = local.app_secrets

  secret_id = "${local.prefix}-${each.key}"
  labels    = local.labels

  # User-managed replication is required in order to attach a CMEK key, and
  # the key must live in the same region as the replica.
  replication {
    user_managed {
      replicas {
        location = var.region

        customer_managed_encryption {
          kms_key_name = google_kms_crypto_key.secrets_cmek.id
        }
      }
    }
  }

  depends_on = [google_kms_crypto_key_iam_member.secretmanager_agent_cmek]
}

# Terraform generates the values it can, so no human ever sees or pastes them.
# They land in Terraform state - keep state in the CMEK-encrypted GCS bucket
# and restrict bucket IAM accordingly.
resource "random_password" "generated" {
  for_each = { for k, v in local.app_secrets : k => v if v.generate }

  length  = 48
  special = false
}

resource "google_secret_manager_secret_version" "app" {
  for_each = { for k, v in local.app_secrets : k => v if v.generate }

  secret      = google_secret_manager_secret.app[each.key].id
  secret_data = random_password.generated[each.key].result
}

resource "google_secret_manager_secret" "breakglass_db_password" {
  secret_id = "${local.prefix}-breakglass-db-password"
  labels    = merge(local.labels, { break_glass = "true" })

  replication {
    user_managed {
      replicas {
        location = var.region

        customer_managed_encryption {
          kms_key_name = google_kms_crypto_key.secrets_cmek.id
        }
      }
    }
  }

  depends_on = [google_kms_crypto_key_iam_member.secretmanager_agent_cmek]
}

resource "google_secret_manager_secret_version" "breakglass_db_password" {
  secret      = google_secret_manager_secret.breakglass_db_password.id
  secret_data = random_password.breakglass.result
}

# --- Access -----------------------------------------------------------------
# The runtime reads only the secrets it needs. Note the break-glass password is
# NOT granted to the backend: it is for a human with an approved change ticket.
resource "google_secret_manager_secret_iam_member" "backend_access" {
  for_each = google_secret_manager_secret.app

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend.email}"
}
