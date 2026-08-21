# ---------------------------------------------------------------------------
# Detection. Encryption prevents; monitoring is how you find out it was tested.
# ---------------------------------------------------------------------------

resource "google_monitoring_notification_channel" "email" {
  count = var.alert_email == "" ? 0 : 1

  display_name = "KYCVault security alerts"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }
}

locals {
  channels = var.alert_email == "" ? [] : [google_monitoring_notification_channel.email[0].id]
}

# Any principal other than the backend or migrator touching the PII KEK is,
# by definition, not a normal code path.
resource "google_logging_metric" "unexpected_kek_use" {
  name   = "${local.prefix}-unexpected-kek-use"
  filter = <<-EOT
    resource.type="cloudkms_cryptokey"
    resource.labels.crypto_key_id="${google_kms_crypto_key.pii_kek.name}"
    protoPayload.methodName=~"Decrypt|Encrypt"
    NOT protoPayload.authenticationInfo.principalEmail="${google_service_account.backend.email}"
    NOT protoPayload.authenticationInfo.principalEmail="${google_service_account.migrator.email}"
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "unexpected_kek_use" {
  count = var.alert_email == "" ? 0 : 1

  display_name = "PII KEK used by an unexpected principal"
  combiner     = "OR"

  conditions {
    display_name = "Any unexpected decrypt or encrypt"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.unexpected_kek_use.name}\" AND resource.type=\"cloudkms_cryptokey\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  notification_channels = local.channels

  documentation {
    content   = "A principal outside the backend and migrator service accounts used the PII key-encryption key. Treat as a potential compromise: review the Cloud Audit Log entry, identify the principal, and revoke its IAM binding before investigating further."
    mime_type = "text/markdown"
  }
}

# Signing-key use spikes are the tell for an operator-key abuse attempt.
resource "google_logging_metric" "operator_signing_use" {
  name   = "${local.prefix}-operator-signing-use"
  filter = <<-EOT
    resource.type="cloudkms_cryptokeyversion"
    resource.labels.crypto_key_id="${google_kms_crypto_key.operator_signing.name}"
    protoPayload.methodName="AsymmetricSign"
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "signing_rate" {
  count = var.alert_email == "" ? 0 : 1

  display_name = "Ethereum operator signing rate anomaly"
  combiner     = "OR"

  conditions {
    display_name = "More than 60 signatures in 5 minutes"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.operator_signing_use.name}\" AND resource.type=\"cloudkms_cryptokeyversion\""
      comparison      = "COMPARISON_GT"
      threshold_value = 60
      duration        = "300s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  notification_channels = local.channels

  documentation {
    content   = "The KMS operator key signed more transactions than a normal verification/consent workload produces. Check for a compromised JWT, a stuck retry loop in the nonce queue, or an attacker driving /api/kyc/verify."
    mime_type = "text/markdown"
  }
}

# Any use of the break-glass database account should be a planned event.
resource "google_logging_metric" "breakglass_login" {
  name   = "${local.prefix}-breakglass-secret-access"
  filter = <<-EOT
    resource.type="audited_resource"
    protoPayload.serviceName="secretmanager.googleapis.com"
    protoPayload.methodName="google.cloud.secretmanager.v1.SecretManagerService.AccessSecretVersion"
    protoPayload.resourceName=~"${google_secret_manager_secret.breakglass_db_password.secret_id}"
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "breakglass" {
  count = var.alert_email == "" ? 0 : 1

  display_name = "Break-glass database password accessed"
  combiner     = "OR"

  conditions {
    display_name = "Any access"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.breakglass_login.name}\" AND resource.type=\"audited_resource\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  notification_channels = local.channels

  documentation {
    content   = "Someone read the break-glass Postgres password. Confirm it maps to an approved change ticket, then rotate it (`terraform taint random_password.breakglass && terraform apply`)."
    mime_type = "text/markdown"
  }
}
