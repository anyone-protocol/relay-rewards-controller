job "relay-rewards-controller-stage" {
  datacenters = ["ator-fin"]
  type = "service"

  group "relay-rewards-controller-stage-group" {
    
    count = 2

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
      mode = "bridge"
      port "http" {
        to = 3000
        host_network = "wireguard"
      }
    }

    task "relay-rewards-controller-stage-service" {
      driver = "docker"
      config {
        image = "ghcr.io/anyone-protocol/relay-rewards-controller:[[.deploy]]"
        force_pull = true
      }

      vault {
        policies = ["valid-ator-stage"]
      }

      template {
        data = <<EOH
        {{with secret "kv/valid-ator/stage"}}
          RELAY_REWARDS_CONTROLLER_KEY="{{.Data.data.DISTRIBUTION_OPERATOR_KEY}}"
          OPERATOR_REGISTRY_CONTROLLER_KEY="{{.Data.data.RELAY_REGISTRY_OPERATOR_KEY}}"

          BUNDLER_NETWORK="{{.Data.data.IRYS_NETWORK}}"
          BUNDLER_CONTROLLER_KEY="{{.Data.data.DISTRIBUTION_OPERATOR_KEY}}"
          
          JSON_RPC="{{.Data.data.JSON_RPC}}"
        {{end}}
        OPERATOR_REGISTRY_PROCESS_ID="[[ consulKey "smart-contracts/stage/operator-registry-address" ]]"
        RELAY_REWARDS_PROCESS_ID="[[ consulKey "smart-contracts/stage/relay-rewards-address" ]]"
        TOKEN_CONTRACT_ADDRESS="[[ consulKey "ator-token/sepolia/stage/address" ]]"
        {{- range service "validator-stage-mongo" }}
          MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/relay-rewards-controller-stage-testnet"
        {{- end }}
        {{- range service "relay-rewards-controller-redis-stage" }}
          REDIS_HOSTNAME="{{ .Address }}"
          REDIS_PORT="{{ .Port }}"
        {{- end }}

        {{- range service "onionoo-war-stage" }}
          ONIONOO_DETAILS_URI="http://{{ .Address }}:{{ .Port }}/details"
        {{- end }}
        EOH
        destination = "secrets/file.env"
        env         = true
      }

      env {
        BUMP="1"
        IS_LIVE="true"
        VERSION="[[.commit_sha]]"
        BUNDLER_NODE="https://arweave.mainnet.irys.xyz"
        GEODATADIR="/geo-ip-db/data"
        GEOTMPDIR="/geo-ip-db/tmp"
        CPU_COUNT="2"
        DO_CLEAN="false"
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