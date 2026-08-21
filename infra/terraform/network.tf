# Dedicated VPC. Cloud SQL gets a private address inside it and never receives
# a public IP, so the database is unreachable from the internet by construction
# rather than by firewall rule.
resource "google_compute_network" "main" {
  name                    = "${local.prefix}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"

  depends_on = [google_project_service.required]
}

resource "google_compute_subnetwork" "main" {
  name                     = "${local.prefix}-subnet"
  region                   = var.region
  network                  = google_compute_network.main.id
  ip_cidr_range            = "10.20.0.0/24"
  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

# Reserved range that Service Networking hands to the Cloud SQL tenant project
# when it peers our VPC. Cloud SQL's private IP is allocated out of this block.
resource "google_compute_global_address" "private_ip_range" {
  name          = "${local.prefix}-sql-private-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_range.name]

  # Without this, `terraform destroy` leaves a dangling peering that blocks the
  # VPC from ever being deleted.
  deletion_policy = "ABANDON"
}

# Serverless VPC Access connector: the bridge that lets Cloud Run reach the
# Cloud SQL private IP. Its own /28 must not overlap the subnet above.
resource "google_vpc_access_connector" "main" {
  name          = "${local.prefix}-vpcconn"
  region        = var.region
  network       = google_compute_network.main.name
  ip_cidr_range = "10.20.8.0/28"

  min_instances = 2
  max_instances = 3
  machine_type  = "e2-micro"

  depends_on = [google_project_service.required]
}

# Deny-all egress baseline, then allow only what the backend legitimately needs.
resource "google_compute_firewall" "deny_all_egress" {
  name               = "${local.prefix}-deny-all-egress"
  network            = google_compute_network.main.name
  direction          = "EGRESS"
  priority           = 65000
  destination_ranges = ["0.0.0.0/0"]

  deny {
    protocol = "all"
  }

  log_config {
    metadata = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_firewall" "allow_sql_egress" {
  name               = "${local.prefix}-allow-sql-egress"
  network            = google_compute_network.main.name
  direction          = "EGRESS"
  priority           = 1000
  destination_ranges = [google_compute_global_address.private_ip_range.address == null ? "10.0.0.0/8" : "${google_compute_global_address.private_ip_range.address}/${google_compute_global_address.private_ip_range.prefix_length}"]

  allow {
    protocol = "tcp"
    ports    = ["5432"]
  }
}

# KMS, Secret Manager, Cloud Logging and the Ethereum RPC are all reached over
# HTTPS. Private Google Access keeps the Google-owned calls off the public path.
resource "google_compute_firewall" "allow_https_egress" {
  name               = "${local.prefix}-allow-https-egress"
  network            = google_compute_network.main.name
  direction          = "EGRESS"
  priority           = 1000
  destination_ranges = ["0.0.0.0/0"]

  allow {
    protocol = "tcp"
    ports    = ["443"]
  }
}
