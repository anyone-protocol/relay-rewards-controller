job "relay-rewards-controller-live" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "live-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "live-protocol"
  }

  group "relay-rewards-controller-live-group" {
    count = 1

    update {
      max_parallel     = 1
      canary           = 1
      min_healthy_time = "30s"
      healthy_deadline = "5m"
      auto_revert      = true
      auto_promote     = true
    }

    network {
      port "http" {
        host_network = "wireguard"
      }
    }

    task "relay-rewards-controller-live-service" {
      kill_timeout = "30s"
      driver = "docker"
      config {
        network_mode = "host"
        image = "ghcr.io/anyone-protocol/relay-rewards-controller:[[ .commit_sha ]]"
        force_pull = true
      }

      vault {
        role = "any1-nomad-workloads-controller"
      }

      identity {
        name = "vault_default"
        aud  = ["any1-infra"]
        ttl  = "1h"
      }

      template {
        data = <<-EOH
        {{with secret "kv/live-protocol/relay-rewards-controller-live"}}
        RELAY_REWARDS_CONTROLLER_KEY="{{.Data.data.RELAY_REWARDS_CONTROLLER_KEY}}"

        BUNDLER_NETWORK="{{.Data.data.BUNDLER_NETWORK}}"
        BUNDLER_CONTROLLER_KEY="{{.Data.data.BUNDLER_CONTROLLER_KEY}}"
        
        JSON_RPC="{{.Data.data.JSON_RPC}}"
        
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN_RELAY_REWARDS}}"
        {{end}}
        EOH
        destination = "secrets/keys.env"
        env         = true
      }

      template {
        data = <<-EOH
        OPERATOR_REGISTRY_PROCESS_ID="{{ key "smart-contracts/live/operator-registry-address" }}"
        RELAY_REWARDS_PROCESS_ID="{{ key "smart-contracts/live/relay-rewards-address" }}"
        TOKEN_CONTRACT_ADDRESS="{{ key "ator-token/sepolia/live/address" }}"
        HODLER_CONTRACT_ADDRESS="{{ key "hodler/sepolia/live/address" }}"

        {{- range service "validator-live-mongo" }}
        MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/relay-rewards-controller-live-testnet"
        {{- end }}

        {{- range service "relay-rewards-controller-redis-live" }}
        REDIS_HOSTNAME="{{ .Address }}"
        REDIS_PORT="{{ .Port }}"
        {{- end }}

        {{- range service "onionoo-war-live" }}
        ONIONOO_DETAILS_URI="http://{{ .Address }}:{{ .Port }}/details"
        {{- end }}

        {{- range service "api-service-live" }}
        API_SERVICE_URL="http://{{ .Address }}:{{ .Port }}"
        {{ end -}}
        EOH
        destination = "local/config.env"
        env         = true
      }

      env {
        IS_LIVE="true"
        VERSION="[[ .commit_sha ]]"
        USE_HODLER = "false"
        BUNDLER_GATEWAY="https://ar.anyone.tech"
        BUNDLER_NODE="https://ar.anyone.tech/bundler"
        GEODATADIR="/geo-ip-db/data"
        GEOTMPDIR="/geo-ip-db/tmp"
        CPU_COUNT="1"
        CONSUL_HOST="${NOMAD_IP_http}"
        CONSUL_PORT="8500"
        SERVICE_NAME="relay-rewards-controller-live"
        ROUND_PERIOD_SECONDS="3600"
        DO_CLEAN="true"
        PORT="${NOMAD_PORT_http}"
        NO_COLOR="1"
        CU_URL="https://cu.anyone.permaweb.services"
      }
      
      resources {
        cpu    = 2048
        memory = 2048
      }

      service {
        name = "relay-rewards-controller-live"
        port = "http"
        tags = ["logging"]
        
        check {
          name     = "live relay-rewards-controller health check"
          type     = "http"
          path     = "/health"
          interval = "5s"
          timeout  = "10s"
          check_restart {
            limit = 10
            grace = "15s"
          }
        }
      }
    }
  }
}