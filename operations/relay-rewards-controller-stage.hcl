job "relay-rewards-controller-stage" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "stage-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

  group "relay-rewards-controller-stage-group" {
    
    count = 1

    update {
      max_parallel     = 1
      min_healthy_time = "30s"
      healthy_deadline = "5m"
    }

    volume "geo-ip-db" {
      type      = "host"
      read_only = false
      source    = "geo-ip-db"
    }

    network {
      port "http" {
        host_network = "wireguard"
      }
    }

    task "relay-rewards-controller-stage-service" {
      kill_timeout = "30s"
      driver = "docker"
      config {
        network_mode = "host"
        image = "ghcr.io/anyone-protocol/relay-rewards-controller:[[.deploy]]"
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
        data = <<EOH
        {{with secret "kv/stage-protocol/relay-rewards-controller-stage"}}
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
        data = <<EOH
        OPERATOR_REGISTRY_PROCESS_ID="{{ key "smart-contracts/stage/operator-registry-address" }}"
        RELAY_REWARDS_PROCESS_ID="{{ key "smart-contracts/stage/relay-rewards-address" }}"
        TOKEN_CONTRACT_ADDRESS="{{ key "ator-token/sepolia/stage/address" }}"
        HODLER_CONTRACT_ADDRESS="{{ key "hodler/sepolia/stage/address" }}"
        {{- range service "validator-stage-mongo" }}
          MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/relay-rewards-controller-stage-testnet"
        {{- end }}
        {{- range service "relay-rewards-controller-redis-stage" }}
          REDIS_HOSTNAME="{{ .Address }}"
          REDIS_PORT="{{ .Port }}"
        {{- end }}

        {{- range service "onionoo-war-live" }}
          ONIONOO_DETAILS_URI="http://{{ .Address }}:{{ .Port }}/details"
        {{- end }}
        EOH
        destination = "local/config.env"
        env         = true
      }

      env {
        BUMP="redeploy-rewards-3"
        IS_LIVE="true"
        VERSION="[[.commit_sha]]"
        USE_HODLER = "true"
        BUNDLER_GATEWAY="https://ar.anyone.tech"
        BUNDLER_NODE="https://ar.anyone.tech/bundler"
        GEODATADIR="/geo-ip-db/data"
        GEOTMPDIR="/geo-ip-db/tmp"
        CPU_COUNT="1"
        CONSUL_HOST="${NOMAD_IP_http}"
        CONSUL_PORT="8500"
        SERVICE_NAME="relay-rewards-controller-stage"
        ROUND_PERIOD_SECONDS="900"
        DO_CLEAN="true"
        PORT="${NOMAD_PORT_http}"
        NO_COLOR="1"
        CU_URL="https://cu.anyone.permaweb.services"
      }

      volume_mount {
        volume      = "geo-ip-db"
        destination = "/geo-ip-db"
        read_only   = false
      }
      
      resources {
        cpu    = 2048
        memory = 2048
      }

      service {
        name = "relay-rewards-controller-stage"
        port = "http"
        tags = ["logging"]
        check {
          name     = "stage relay-rewards-controller health check"
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
