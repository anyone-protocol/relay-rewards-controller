job "relay-rewards-controller-redis-sentinel-live" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "live-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "live-protocol"
  }

  group "relay-rewards-controller-redis-sentinel-live-group" {
    count = 1

    network {
      port "redis-master" {
        host_network = "wireguard"
      }
      port "redis-replica-1" {
        host_network = "wireguard"
      }
      port "redis-replica-2" {
        host_network = "wireguard"
      }
      port "sentinel-1" {
        host_network = "wireguard"
      }
      port "sentinel-2" {
        host_network = "wireguard"
      }
      port "sentinel-3" {
        host_network = "wireguard"
      }
    }

    volume "relay-rewards-controller-redis-sentinel-live-master-data" {
      type      = "host"
      source    = "relay-rewards-controller-redis-sentinel-live-master-data"
      read_only = false
    }

    volume "relay-rewards-controller-redis-sentinel-live-replica-1-data" {
      type      = "host"
      source    = "relay-rewards-controller-redis-sentinel-live-replica-1-data"
      read_only = false
    }

    volume "relay-rewards-controller-redis-sentinel-live-replica-2-data" {
      type      = "host"
      source    = "relay-rewards-controller-redis-sentinel-live-replica-2-data"
      read_only = false
    }

    task "relay-rewards-controller-redis-sentinel-live-redis-master-task" {
      driver = "docker"

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOH
        {{- with secret "kv/live-protocol/relay-rewards-controller-redis-sentinel-live" }}
        requirepass "{{ .Data.data.REDIS_PASSWORD }}"
        masterauth "{{ .Data.data.REDIS_PASSWORD }}"
        {{- end }}
        EOH
        destination = "secrets/auth.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:8.10.3@sha256:f245f4c83b84a9e9a0588da1c9456e579455310f0945d5db52cd2ba27f2000cc"
        network_mode = "host"

        args = [
          "redis-server",
          "/usr/local/etc/redis/auth.conf",
          "--port", "${NOMAD_PORT_redis_master}",
          "--appendonly", "yes",
          "--repl-diskless-load", "on-empty-db",
          "--replica-announce-ip", "${NOMAD_IP_redis_master}",
          "--replica-announce-port", "${NOMAD_PORT_redis_master}",
          "--protected-mode", "no",
          "--bind", "${NOMAD_IP_redis_master}"
        ]
        volumes = [ "secrets/auth.conf:/usr/local/etc/redis/auth.conf:ro" ]
      }

      volume_mount {
        volume      = "relay-rewards-controller-redis-sentinel-live-master-data"
        destination = "/data"
        read_only   = false
      }

      resources {
        cpu    = 1024
        memory = 2048
      }
    }

    task "relay-rewards-controller-redis-sentinel-live-redis-replica-1-task" {
      driver = "docker"

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOH
        {{- with secret "kv/live-protocol/relay-rewards-controller-redis-sentinel-live" }}
        requirepass "{{ .Data.data.REDIS_PASSWORD }}"
        masterauth "{{ .Data.data.REDIS_PASSWORD }}"
        {{- end }}
        EOH
        destination = "secrets/auth.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:8.10.3@sha256:f245f4c83b84a9e9a0588da1c9456e579455310f0945d5db52cd2ba27f2000cc"
        network_mode = "host"

        args = [
          "redis-server",
          "/usr/local/etc/redis/auth.conf",
          "--port", "${NOMAD_PORT_redis_replica_1}",
          "--appendonly", "yes",
          "--replicaof", "${NOMAD_IP_redis_master}", "${NOMAD_PORT_redis_master}",
          "--repl-diskless-load", "on-empty-db",
          "--replica-announce-ip", "${NOMAD_IP_redis_replica_1}",
          "--replica-announce-port", "${NOMAD_PORT_redis_replica_1}",
          "--protected-mode", "no",
          "--bind", "${NOMAD_IP_redis_replica_1}"
        ]
        volumes = [ "secrets/auth.conf:/usr/local/etc/redis/auth.conf:ro" ]
      }

      volume_mount {
        volume      = "relay-rewards-controller-redis-sentinel-live-replica-1-data"
        destination = "/data"
        read_only   = false
      }

      resources {
        cpu    = 1024
        memory = 1024
      }
    }

    task "relay-rewards-controller-redis-sentinel-live-redis-replica-2-task" {
      driver = "docker"

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOH
        {{- with secret "kv/live-protocol/relay-rewards-controller-redis-sentinel-live" }}
        requirepass "{{ .Data.data.REDIS_PASSWORD }}"
        masterauth "{{ .Data.data.REDIS_PASSWORD }}"
        {{- end }}
        EOH
        destination = "secrets/auth.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:8.10.3@sha256:f245f4c83b84a9e9a0588da1c9456e579455310f0945d5db52cd2ba27f2000cc"
        network_mode = "host"

        args = [
          "redis-server",
          "/usr/local/etc/redis/auth.conf",
          "--port", "${NOMAD_PORT_redis_replica_2}",
          "--appendonly", "yes",
          "--replicaof", "${NOMAD_IP_redis_master}", "${NOMAD_PORT_redis_master}",
          "--repl-diskless-load", "on-empty-db",
          "--replica-announce-ip", "${NOMAD_IP_redis_replica_2}",
          "--replica-announce-port", "${NOMAD_PORT_redis_replica_2}",
          "--protected-mode", "no",
          "--bind", "${NOMAD_IP_redis_replica_2}"
        ]
        volumes = [ "secrets/auth.conf:/usr/local/etc/redis/auth.conf:ro" ]
      }

      volume_mount {
        volume      = "relay-rewards-controller-redis-sentinel-live-replica-2-data"
        destination = "/data"
        read_only   = false
      }

      resources {
        cpu    = 1024
        memory = 1024
      }
    }

    task "relay-rewards-controller-redis-sentinel-live-sentinel-1-task" {
      driver = "docker"

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOT
        bind {{ env "NOMAD_IP_sentinel_1" }}
        sentinel monitor relay-rewards-controller-live-redis-master {{ env "NOMAD_IP_redis_master" }} {{ env "NOMAD_PORT_redis_master" }} 2
        sentinel resolve-hostnames yes
        sentinel down-after-milliseconds relay-rewards-controller-live-redis-master 10000
        sentinel failover-timeout relay-rewards-controller-live-redis-master 10000
        sentinel parallel-syncs relay-rewards-controller-live-redis-master 1
        {{- with secret "kv/live-protocol/relay-rewards-controller-redis-sentinel-live" }}
        requirepass "{{ .Data.data.REDIS_PASSWORD }}"
        sentinel auth-pass relay-rewards-controller-live-redis-master "{{ .Data.data.REDIS_PASSWORD }}"
        {{- end }}
        EOT
        destination = "secrets/sentinel.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:8.10.3@sha256:f245f4c83b84a9e9a0588da1c9456e579455310f0945d5db52cd2ba27f2000cc"
        network_mode = "host"
        entrypoint = ["/bin/sh", "-c"]
        args = [
          "cp /secrets/sentinel.conf /data/sentinel.conf && exec /usr/local/bin/docker-entrypoint.sh redis-sentinel /data/sentinel.conf --port ${NOMAD_PORT_sentinel_1}"
        ]
      }

      resources {
        cpu    = 256
        memory = 256
      }
    }

    task "relay-rewards-controller-redis-sentinel-live-sentinel-2-task" {
      driver = "docker"

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOT
        bind {{ env "NOMAD_IP_sentinel_2" }}
        sentinel monitor relay-rewards-controller-live-redis-master {{ env "NOMAD_IP_redis_master" }} {{ env "NOMAD_PORT_redis_master" }} 2
        sentinel resolve-hostnames yes
        sentinel down-after-milliseconds relay-rewards-controller-live-redis-master 10000
        sentinel failover-timeout relay-rewards-controller-live-redis-master 10000
        sentinel parallel-syncs relay-rewards-controller-live-redis-master 1
        {{- with secret "kv/live-protocol/relay-rewards-controller-redis-sentinel-live" }}
        requirepass "{{ .Data.data.REDIS_PASSWORD }}"
        sentinel auth-pass relay-rewards-controller-live-redis-master "{{ .Data.data.REDIS_PASSWORD }}"
        {{- end }}
        EOT
        destination = "secrets/sentinel.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:8.10.3@sha256:f245f4c83b84a9e9a0588da1c9456e579455310f0945d5db52cd2ba27f2000cc"
        network_mode = "host"
        entrypoint = ["/bin/sh", "-c"]
        args = [
          "cp /secrets/sentinel.conf /data/sentinel.conf && exec /usr/local/bin/docker-entrypoint.sh redis-sentinel /data/sentinel.conf --port ${NOMAD_PORT_sentinel_2}"
        ]
      }

      resources {
        cpu    = 256
        memory = 256
      }
    }

    task "relay-rewards-controller-redis-sentinel-live-sentinel-3-task" {
      driver = "docker"

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOT
        bind {{ env "NOMAD_IP_sentinel_3" }}
        sentinel monitor relay-rewards-controller-live-redis-master {{ env "NOMAD_IP_redis_master" }} {{ env "NOMAD_PORT_redis_master" }} 2
        sentinel resolve-hostnames yes
        sentinel down-after-milliseconds relay-rewards-controller-live-redis-master 10000
        sentinel failover-timeout relay-rewards-controller-live-redis-master 10000
        sentinel parallel-syncs relay-rewards-controller-live-redis-master 1
        {{- with secret "kv/live-protocol/relay-rewards-controller-redis-sentinel-live" }}
        requirepass "{{ .Data.data.REDIS_PASSWORD }}"
        sentinel auth-pass relay-rewards-controller-live-redis-master "{{ .Data.data.REDIS_PASSWORD }}"
        {{- end }}
        EOT
        destination = "secrets/sentinel.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:8.10.3@sha256:f245f4c83b84a9e9a0588da1c9456e579455310f0945d5db52cd2ba27f2000cc"
        network_mode = "host"
        entrypoint = ["/bin/sh", "-c"]
        args = [
          "cp /secrets/sentinel.conf /data/sentinel.conf && exec /usr/local/bin/docker-entrypoint.sh redis-sentinel /data/sentinel.conf --port ${NOMAD_PORT_sentinel_3}"
        ]
      }

      resources {
        cpu    = 256
        memory = 256
      }
    }

    service {
      name = "relay-rewards-controller-live-redis-master"
      port = "redis-master"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
      }
    }

    service {
      name = "relay-rewards-controller-live-redis-replica-1"
      port = "redis-replica-1"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
      }
    }

    service {
      name = "relay-rewards-controller-live-redis-replica-2"
      port = "redis-replica-2"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
      }
    }

    service {
      name = "relay-rewards-controller-live-sentinel-1"
      port = "sentinel-1"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
      }
    }

    service {
      name = "relay-rewards-controller-live-sentinel-2"
      port = "sentinel-2"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
      }
    }

    service {
      name = "relay-rewards-controller-live-sentinel-3"
      port = "sentinel-3"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
      }
    }
  }
}
