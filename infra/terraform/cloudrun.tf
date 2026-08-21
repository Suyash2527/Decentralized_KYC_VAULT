# ---------------------------------------------------------------------------
# Cloud Run service, two containers:
#
#   backend    the Express app. Talks to Postgres on 127.0.0.1:5432.
#   cloudsql   the Cloud SQL Auth Proxy sidecar. Holds the mTLS tunnel to the
#              private-IP instance and injects a fresh OAuth token as the
#              Postgres password on every connection (--auto-iam-authn).
#
# The proxy is why no database password exists in this system. Prisma has no
# native Cloud SQL connector, so the sidecar is the supported pattern.
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "backend" {
  name     = "${local.prefix}-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  deletion_protection = false
  labels              = local.labels

  template {
    service_account = google_service_account.backend.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    # All egress through the connector, so database traffic stays on the VPC
    # and every outbound call is subject to the firewall rules above.
    vpc_access {
      connector = google_vpc_access_connector.main.id
      egress    = "ALL_TRAFFIC"
    }

    max_instance_request_concurrency = 40
    timeout                          = "60s"

    containers {
      name  = "cloudsql"
      image = "gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.14.1"

      args = [
        google_sql_database_instance.main.connection_name,
        "--private-ip",
        "--auto-iam-authn",
        "--port=5432",
        "--health-check",
        "--http-address=0.0.0.0",
        "--http-port=9090",
        "--structured-logs",
        "--max-sigterm-delay=30s",
      ]

      startup_probe {
        http_get {
          path = "/startup"
          port = 9090
        }
        period_seconds    = 2
        failure_threshold = 30
      }

      liveness_probe {
        http_get {
          path = "/liveness"
          port = 9090
        }
        period_seconds = 30
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }

    containers {
      name  = "backend"
      image = var.backend_image

      # Cloud Run starts the proxy first and only then the app, so Prisma's
      # first connection does not race the tunnel coming up.
      depends_on = ["cloudsql"]

      ports {
        container_port = 3001
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "1Gi"
        }
        cpu_idle          = false
        startup_cpu_boost = true
      }

      # --- Non-secret configuration ---
      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "PORT"
        value = "3001"
      }

      # sslmode=disable is correct here and only here: the hop is a loopback
      # socket inside the same instance, and the proxy itself holds the mTLS
      # tunnel to Cloud SQL. Setting require would make Prisma try to negotiate
      # TLS with the local proxy, which does not terminate it.
      env {
        name  = "DATABASE_URL"
        value = "postgresql://${urlencode(local.db_iam_user)}@127.0.0.1:5432/${google_sql_database.kycvault.name}?sslmode=disable&connection_limit=10&pool_timeout=20"
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }

      env {
        name  = "KMS_LOCATION"
        value = var.region
      }

      env {
        name  = "KMS_KEY_RING"
        value = google_kms_key_ring.main.name
      }

      env {
        name  = "KMS_PII_KEK"
        value = google_kms_crypto_key.pii_kek.name
      }

      env {
        name  = "KMS_SIGNING_KEY"
        value = google_kms_crypto_key.operator_signing.name
      }

      env {
        name  = "KMS_SIGNING_KEY_VERSION"
        value = "1"
      }

      env {
        name  = "RPC_URL"
        value = var.rpc_url
      }

      env {
        name  = "CONTRACT_ADDRESS"
        value = var.contract_address
      }

      env {
        name  = "CORS_ORIGIN"
        value = var.cors_origin
      }

      # --- Secrets, mounted by reference. The value never appears in the
      #     service YAML, in Terraform plan output, or in deployment history.
      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["jwt-secret"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "VERIFIER_REGISTRATION_CODE"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["verifier-registration-code"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "PARTNER_REGISTRATION_CODE"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["partner-registration-code"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "GCP_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["gcp-vision-api-key"].secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/health"
          port = 3001
        }
        initial_delay_seconds = 5
        period_seconds        = 3
        failure_threshold     = 20
      }

      liveness_probe {
        http_get {
          path = "/health"
          port = 3001
        }
        period_seconds = 30
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_secret_manager_secret_iam_member.backend_access,
    google_kms_crypto_key_iam_member.backend_pii_kek,
    google_kms_crypto_key_iam_member.backend_signer,
    google_sql_user.backend,
  ]
}

# The API is public by design (the SPA calls it from the browser); JWT and the
# per-route role checks are the authorization boundary, not network position.
resource "google_cloud_run_v2_service_iam_member" "public" {
  location = google_cloud_run_v2_service.backend.location
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
