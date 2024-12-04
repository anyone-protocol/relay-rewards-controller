job "relay-rewards-controller-live" {
  datacenters = ["ator-fin"]
  type = "service"

  group "relay-rewards-controller-live-group" {
    
    count = 3

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

    task "relay-rewards-controller-live-service" {
      driver = "docker"
      config {
        image = "ghcr.io/anyone-protocol/relay-rewards-controller:[[.deploy]]"
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
        {{- range service "relay-rewards-controller-redis-live" }}
          REDIS_HOSTNAME="{{ .Address }}"
          REDIS_PORT="{{ .Port }}"
        {{- end }}

        {{- range service "onionoo-war-live" }}
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
        CPU_COUNT="1"
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
        name = "relay-rewards-controller-live"
        port = "http"
        
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
  
  group "relay-rewards-controller-redis-live-group" {
    count = 1

    network {
      mode = "bridge"
      port "redis" {
        host_network = "wireguard"
      }
    }
    task "relay-rewards-controller-redis-live" {
      driver = "docker"
      config {
        image = "redis:7.2"
        args = ["/usr/local/etc/redis/redis.conf"]
        volumes = [
          "local/redis.conf:/usr/local/etc/redis/redis.conf"
        ]
      }

      resources {
        cpu    = 512
        memory = 512
      }

      service {
        name = "relay-rewards-controller-redis-live"
        port = "redis"
        
        check {
          name     = "relay rewards controller live redis health check"
          type     = "tcp"
          interval = "5s"
          timeout  = "10s"
        }
      }

      template {
        data = <<EOH
# Based on https://raw.githubusercontent.com/redis/redis/7.2/redis.conf
bind 0.0.0.0
port {{ env "NOMAD_PORT_redis" }}
protected-mode no
tcp-backlog 511
timeout 0
tcp-keepalive 300
daemonize no
pidfile /tmp/redis_6379.pid
loglevel notice
logfile ""
databases 16
always-show-logo no
set-proc-title yes
proc-title-template "{title} {listen-addr} {server-mode}"
locale-collate ""
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb
rdb-del-sync-files no
dir ./
replica-serve-stale-data yes
replica-read-only yes
repl-diskless-sync yes
repl-diskless-sync-delay 5
repl-diskless-sync-max-replicas 0
repl-diskless-load disabled
repl-disable-tcp-nodelay no
replica-priority 100
acllog-max-len 128
lazyfree-lazy-eviction no
lazyfree-lazy-expire no
lazyfree-lazy-server-del no
replica-lazy-flush no
lazyfree-lazy-user-del no
lazyfree-lazy-user-flush no
oom-score-adj no
oom-score-adj-values 0 200 800
disable-thp yes
appendonly yes
appendfilename "appendonly.aof"
appenddirname "appendonlydir"
appendfsync everysec
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
aof-load-truncated yes
aof-use-rdb-preamble yes
aof-timestamp-enabled no
slowlog-log-slower-than 10000
slowlog-max-len 128
latency-monitor-threshold 0
notify-keyspace-events ""
hash-max-listpack-entries 512
hash-max-listpack-value 64
list-max-listpack-size -2
list-compress-depth 0
set-max-intset-entries 512
set-max-listpack-entries 128
set-max-listpack-value 64
zset-max-listpack-entries 128
zset-max-listpack-value 64
hll-sparse-max-bytes 3000
stream-node-max-bytes 4096
stream-node-max-entries 100
activerehashing yes
client-output-buffer-limit normal 0 0 0
client-output-buffer-limit replica 256mb 64mb 60
client-output-buffer-limit pubsub 32mb 8mb 60
hz 10
dynamic-hz yes
aof-rewrite-incremental-fsync yes
rdb-save-incremental-fsync yes
jemalloc-bg-thread yes
        EOH
        destination = "local/redis.conf"
        env         = false
      }
    }
  }
}