job "relay-rewards-controller-redis-sentinel-stage" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "stage-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

  group "relay-rewards-controller-redis-sentinel-stage-group" {
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

    volume "relay-rewards-controller-redis-sentinel-stage-master-data" {
      type      = "host"
      source    = "relay-rewards-controller-redis-sentinel-stage-master-data"
      read_only = false
    }

    volume "relay-rewards-controller-redis-sentinel-stage-replica-1-data" {
      type      = "host"
      source    = "relay-rewards-controller-redis-sentinel-stage-replica-1-data"
      read_only = false
    }

    volume "relay-rewards-controller-redis-sentinel-stage-replica-2-data" {
      type      = "host"
      source    = "relay-rewards-controller-redis-sentinel-stage-replica-2-data"
      read_only = false
    }

    task "relay-rewards-controller-redis-sentinel-stage-redis-master-task" {
      driver = "docker"

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOH
        {{- with secret "kv/stage-protocol/relay-rewards-controller-redis-sentinel-stage" }}
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
        volume      = "relay-rewards-controller-redis-sentinel-stage-master-data"
        destination = "/data"
        read_only   = false
      }

      resources {
        cpu    = 512
        memory = 512
      }
    }

    task "relay-rewards-controller-redis-sentinel-stage-redis-replica-1-task" {
      driver = "docker"

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOH
        {{- with secret "kv/stage-protocol/relay-rewards-controller-redis-sentinel-stage" }}
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
        volume      = "relay-rewards-controller-redis-sentinel-stage-replica-1-data"
        destination = "/data"
        read_only   = false
      }

      resources {
        cpu    = 512
        memory = 512
      }
    }

    task "relay-rewards-controller-redis-sentinel-stage-redis-replica-2-task" {
      driver = "docker"

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOH
        {{- with secret "kv/stage-protocol/relay-rewards-controller-redis-sentinel-stage" }}
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
        volume      = "relay-rewards-controller-redis-sentinel-stage-replica-2-data"
        destination = "/data"
        read_only   = false
      }

      resources {
        cpu    = 512
        memory = 512
      }
    }

    task "relay-rewards-controller-redis-sentinel-stage-sentinel-1-task" {
      driver = "docker"

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOT
        bind {{ env "NOMAD_IP_sentinel_1" }}
        sentinel monitor relay-rewards-controller-stage-redis-master {{ env "NOMAD_IP_redis_master" }} {{ env "NOMAD_PORT_redis_master" }} 2
        sentinel resolve-hostnames yes
        sentinel down-after-milliseconds relay-rewards-controller-stage-redis-master 10000
        sentinel failover-timeout relay-rewards-controller-stage-redis-master 10000
        sentinel parallel-syncs relay-rewards-controller-stage-redis-master 1
        {{- with secret "kv/stage-protocol/relay-rewards-controller-redis-sentinel-stage" }}
        requirepass "{{ .Data.data.REDIS_PASSWORD }}"
        sentinel auth-pass relay-rewards-controller-stage-redis-master "{{ .Data.data.REDIS_PASSWORD }}"
        {{- end }}
        EOT
        destination = "secrets/sentinel/sentinel.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:8.10.3@sha256:f245f4c83b84a9e9a0588da1c9456e579455310f0945d5db52cd2ba27f2000cc"
        network_mode = "host"
        args = [
          "redis-sentinel",
          "/usr/local/etc/redis-sentinel/sentinel.conf",
          "--port", "${NOMAD_PORT_sentinel_1}"
        ]
        volumes = [ "secrets/sentinel:/usr/local/etc/redis-sentinel" ]
      }

      resources {
        cpu    = 256
        memory = 256
      }
    }

    task "relay-rewards-controller-redis-sentinel-stage-sentinel-2-task" {
      driver = "docker"

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOT
        bind {{ env "NOMAD_IP_sentinel_2" }}
        sentinel monitor relay-rewards-controller-stage-redis-master {{ env "NOMAD_IP_redis_master" }} {{ env "NOMAD_PORT_redis_master" }} 2
        sentinel resolve-hostnames yes
        sentinel down-after-milliseconds relay-rewards-controller-stage-redis-master 10000
        sentinel failover-timeout relay-rewards-controller-stage-redis-master 10000
        sentinel parallel-syncs relay-rewards-controller-stage-redis-master 1
        {{- with secret "kv/stage-protocol/relay-rewards-controller-redis-sentinel-stage" }}
        requirepass "{{ .Data.data.REDIS_PASSWORD }}"
        sentinel auth-pass relay-rewards-controller-stage-redis-master "{{ .Data.data.REDIS_PASSWORD }}"
        {{- end }}
        EOT
        destination = "secrets/sentinel/sentinel.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:8.10.3@sha256:f245f4c83b84a9e9a0588da1c9456e579455310f0945d5db52cd2ba27f2000cc"
        network_mode = "host"
        args = [
          "redis-sentinel",
          "/usr/local/etc/redis-sentinel/sentinel.conf",
          "--port", "${NOMAD_PORT_sentinel_2}"
        ]
        volumes = [ "secrets/sentinel:/usr/local/etc/redis-sentinel" ]
      }

      resources {
        cpu    = 256
        memory = 256
      }
    }

    task "relay-rewards-controller-redis-sentinel-stage-sentinel-3-task" {
      driver = "docker"

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOT
        bind {{ env "NOMAD_IP_sentinel_3" }}
        sentinel monitor relay-rewards-controller-stage-redis-master {{ env "NOMAD_IP_redis_master" }} {{ env "NOMAD_PORT_redis_master" }} 2
        sentinel resolve-hostnames yes
        sentinel down-after-milliseconds relay-rewards-controller-stage-redis-master 10000
        sentinel failover-timeout relay-rewards-controller-stage-redis-master 10000
        sentinel parallel-syncs relay-rewards-controller-stage-redis-master 1
        {{- with secret "kv/stage-protocol/relay-rewards-controller-redis-sentinel-stage" }}
        requirepass "{{ .Data.data.REDIS_PASSWORD }}"
        sentinel auth-pass relay-rewards-controller-stage-redis-master "{{ .Data.data.REDIS_PASSWORD }}"
        {{- end }}
        EOT
        destination = "secrets/sentinel/sentinel.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:8.10.3@sha256:f245f4c83b84a9e9a0588da1c9456e579455310f0945d5db52cd2ba27f2000cc"
        network_mode = "host"
        args = [
          "redis-sentinel",
          "/usr/local/etc/redis-sentinel/sentinel.conf",
          "--port", "${NOMAD_PORT_sentinel_3}"
        ]
        volumes = [ "secrets/sentinel:/usr/local/etc/redis-sentinel" ]
      }

      resources {
        cpu    = 256
        memory = 256
      }
    }

    service {
      name = "relay-rewards-controller-stage-redis-master"
      port = "redis-master"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
      }
    }

    service {
      name = "relay-rewards-controller-stage-redis-replica-1"
      port = "redis-replica-1"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
      }
    }

    service {
      name = "relay-rewards-controller-stage-redis-replica-2"
      port = "redis-replica-2"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
      }
    }

    service {
      name = "relay-rewards-controller-stage-sentinel-1"
      port = "sentinel-1"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
      }
    }

    service {
      name = "relay-rewards-controller-stage-sentinel-2"
      port = "sentinel-2"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
      }
    }

    service {
      name = "relay-rewards-controller-stage-sentinel-3"
      port = "sentinel-3"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
      }
    }
  }
}
