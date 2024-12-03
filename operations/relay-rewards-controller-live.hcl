job "relay-rewards-controller-live" {
  datacenters = ["ator-fin"]
  type = "service"

  group "relay-rewards-controller-live-group" {
    
    count = 1

    network {
      mode = "bridge"
      port "http" {
        to = 3000
        host_network = "wireguard"
      }
    }

    task "relay-rewards-controller-live-service" {
      driver = "docker"
      config {
        image = "ghcr.io/anyone-protocol/valid-ator:[[.deploy]]"
        force_pull = true
      }

      vault {
        policies = ["valid-ator-live"]
      }

      template {
        data = <<EOH
        {{with secret "kv/valid-ator/live"}}
          RELAY_REWARDS_CONTROLLER_KEY="{{.Data.data.DISTRIBUTION_OPERATOR_KEY}}"
          OPERATOR_REGISTRY_CONTROLLER_KEY="{{.Data.data.RELAY_REGISTRY_OPERATOR_KEY}}"

          BUNDLER_NETWORK="{{.Data.data.IRYS_NETWORK}}"
          BUNDLER_CONTROLLER_KEY="{{.Data.data.DISTRIBUTION_OPERATOR_KEY}}"

          JSON_RPC="{{.Data.data.JSON_RPC}}"
          
          EVM_NETWORK="{{.Data.data.INFURA_NETWORK}}"
          EVM_PRIMARY_WSS="{{.Data.data.INFURA_WS_URL}}"
          EVM_SECONDARY_WSS="{{.Data.data.ALCHEMY_WS_URL}}"
        {{end}}
        OPERATOR_REGISTRY_PROCESS_ID="[[ consulKey "smart-contracts/live/operator-registry-address" ]]"
        RELAY_REWARDS_PROCESS_ID="[[ consulKey "smart-contracts/live/relay-rewards-address" ]]"
        TOKEN_CONTRACT_ADDRESS="[[ consulKey "ator-token/sepolia/live/address" ]]"
        {{- range service "validator-live-mongo" }}
          MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/relay-rewards-controller-live-testnet"
        {{- end }}
        {{- range service "validator-live-redis" }}
          REDIS_HOSTNAME="{{ .Address }}"
          REDIS_PORT="{{ .Port }}"
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
        CPU_COUNT="1"
        DO_CLEAN="false"
      }
      
      resources {
        cpu    = 4096
        memory = 8192
      }

      service {
        name = "relay-rewards-controller-live"
        port = "http"
        
        check {
          name     = "live relay-rewards-controller health check"
          type     = "http"
          path     = "/health"
          interval = "5s"
          timeout  = "10s"
          check_restart {
            limit = 180
            grace = "15s"
          }
        }
      }
    }
  }
}