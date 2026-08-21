variable "project_id" {
  description = "GCP project that owns every resource in this stack."
  type        = string
}

variable "region" {
  description = "Primary region. Cloud SQL, KMS keyring, Cloud Run and Secret Manager replicas all live here so that CMEK stays region-local."
  type        = string
  default     = "asia-south1"
}

variable "environment" {
  description = "Short environment name used as a resource-name prefix."
  type        = string
  default     = "prod"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,10}$", var.environment))
    error_message = "environment must be lowercase alphanumeric with hyphens, 2-11 chars."
  }
}

variable "db_tier" {
  description = "Cloud SQL machine type. db-custom-2-7680 is the smallest tier that supports HA + read replicas comfortably."
  type        = string
  default     = "db-custom-2-7680"
}

variable "db_disk_size_gb" {
  description = "Initial data disk size. Autoresize is on, so this is a floor, not a cap."
  type        = number
  default     = 20
}

variable "db_availability_type" {
  description = "REGIONAL gives a synchronous standby in a second zone (required for the production SLA). ZONAL is cheaper for non-prod."
  type        = string
  default     = "REGIONAL"

  validation {
    condition     = contains(["REGIONAL", "ZONAL"], var.db_availability_type)
    error_message = "db_availability_type must be REGIONAL or ZONAL."
  }
}

variable "db_deletion_protection" {
  description = "Blocks terraform destroy from dropping the instance holding PII."
  type        = bool
  default     = true
}

variable "key_rotation_period" {
  description = "Automatic rotation interval for symmetric KMS keys, in seconds. 90 days is the common regulated-industry cadence."
  type        = string
  default     = "7776000s"
}

variable "kms_protection_level" {
  description = "SOFTWARE or HSM. HSM is FIPS 140-2 Level 3 and is what an auditor expects for key material protecting PII."
  type        = string
  default     = "HSM"

  validation {
    condition     = contains(["SOFTWARE", "HSM"], var.kms_protection_level)
    error_message = "kms_protection_level must be SOFTWARE or HSM."
  }
}

variable "backend_image" {
  description = "Fully qualified Artifact Registry image for the backend, e.g. asia-south1-docker.pkg.dev/PROJECT/kycvault/backend:sha-abc123. Always deploy by digest or immutable tag, never :latest."
  type        = string
}

variable "cors_origin" {
  description = "Comma-separated list of allowed browser origins for the API."
  type        = string
}

variable "rpc_url" {
  description = "Ethereum JSON-RPC endpoint used for reads and broadcasts."
  type        = string
  default     = "https://ethereum-sepolia-rpc.publicnode.com"
}

variable "contract_address" {
  description = "Deployed KYCVault contract address."
  type        = string
}

variable "min_instances" {
  description = "Cloud Run minimum instances. Keep >= 1 in production: a cold start re-runs KMS key discovery and Cloud SQL Auth Proxy handshake."
  type        = number
  default     = 1
}

variable "max_instances" {
  description = "Cloud Run maximum instances. Bounded because every instance opens Cloud SQL connections."
  type        = number
  default     = 10
}

variable "alert_email" {
  description = "Address that receives KMS/Cloud SQL security alerts. Leave empty to skip notification-channel creation."
  type        = string
  default     = ""
}

variable "labels" {
  description = "Labels applied to every resource that supports them. data_classification drives DLP and access-review tooling."
  type        = map(string)
  default = {
    application         = "kycvault"
    data_classification = "restricted-pii"
    compliance          = "dpdp-rbi"
    managed_by          = "terraform"
  }
}
