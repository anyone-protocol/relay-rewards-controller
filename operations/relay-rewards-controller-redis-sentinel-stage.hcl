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
      mode = "bridge"
      port "redis-master" {
        static = 6388
        host_network = "wireguard"
      }
      port "redis-replica-1" {
        static = 6389
        host_network = "wireguard"
      }
      port "redis-replica-2" {
        static = 6391
        host_network = "wireguard"
      }
      port "sentinel-1" {
        static = 26388
        host_network = "wireguard"
      }
      port "sentinel-2" {
        static = 26389
        host_network = "wireguard"
      }
      port "sentinel-3" {
        static = 26391
        host_network = "wireguard"
      }
    }

    # volume "redis-master-data" {
    #   type      = "host"
    #   source    = "redis-master-data"
    #   read_only = false
    # }

    # volume "redis-replica-1-data" {
    #   type      = "host"
    #   source    = "redis-replica-1-data"
    #   read_only = false
    # }

    # volume "redis-replica-2-data" {
    #   type      = "host"
    #   source    = "redis-replica-2-data"
    #   read_only = false
    # }

    task "relay-rewards-controller-redis-sentinel-stage-redis-master-task" {
      driver = "docker"

      config {
        image = "redis:latest"
        ports = ["redis-master"]

        args = [
          "redis-server",
          "--port", "${NOMAD_PORT_redis_master}",
          "--appendonly", "yes",
          "--repl-diskless-load", "on-empty-db",
          "--replica-announce-ip", "${NOMAD_IP_redis_master}",
          "--replica-announce-port", "${NOMAD_PORT_redis_master}",
          "--protected-mode", "no",
          "--bind", "0.0.0.0"
        ]
      }

      # volume_mount {
      #   volume      = "redis-master-data"
      #   destination = "/data"
      #   read_only   = false
      # }

      resources {
        cpu    = 1024
        memory = 2048
      }
    }

    task "relay-rewards-controller-redis-sentinel-stage-redis-replica-1-task" {
      driver = "docker"

      config {
        image = "redis:latest"
        ports = ["redis-replica-1"]

        args = [
          "redis-server",
          "--port", "${NOMAD_PORT_redis_replica_1}",
          "--appendonly", "yes",
          "--replicaof", "${NOMAD_IP_redis_master}", "${NOMAD_PORT_redis_master}",
          "--repl-diskless-load", "on-empty-db",
          "--replica-announce-ip", "${NOMAD_IP_redis_replica_1}",
          "--replica-announce-port", "${NOMAD_PORT_redis_replica_1}",
          "--protected-mode", "no",
          "--bind", "0.0.0.0"
        ]
      }

      # volume_mount {
      #   volume      = "redis-replica-1-data"
      #   destination = "/data"
      #   read_only   = false
      # }

      resources {
        cpu    = 1024
        memory = 1024
      }
    }

    task "relay-rewards-controller-redis-sentinel-stage-redis-replica-2-task" {
      driver = "docker"

      config {
        image = "redis:latest"
        ports = ["redis-replica-2"]

        args = [
          "redis-server",
          "--port", "${NOMAD_PORT_redis_replica_2}",
          "--appendonly", "yes",
          "--replicaof", "${NOMAD_IP_redis_master}", "${NOMAD_PORT_redis_master}",
          "--repl-diskless-load", "on-empty-db",
          "--replica-announce-ip", "${NOMAD_IP_redis_replica_2}",
          "--replica-announce-port", "${NOMAD_PORT_redis_replica_2}",
          "--protected-mode", "no",
          "--bind", "0.0.0.0"
        ]
      }

      # volume_mount {
      #   volume      = "redis-replica-2-data"
      #   destination = "/data"
      #   read_only   = false
      # }

      resources {
        cpu    = 1024
        memory = 1024
      }
    }

    task "relay-rewards-controller-redis-sentinel-stage-sentinel-1-task" {
      driver = "docker"

      template {
        data = <<-EOT
        bind 0.0.0.0
        sentinel monitor relay-rewards-controller-stage-redis-master {{ env "NOMAD_IP_redis_master" }} {{ env "NOMAD_PORT_redis_master" }} 2
        sentinel resolve-hostnames yes
        sentinel down-after-milliseconds relay-rewards-controller-stage-redis-master 10000
        sentinel failover-timeout relay-rewards-controller-stage-redis-master 10000
        sentinel parallel-syncs relay-rewards-controller-stage-redis-master 1
        EOT
        destination = "local/sentinel.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:latest"
        ports = ["sentinel-1"]
        args = [
          "redis-sentinel",
          "/local/sentinel.conf",
          "--port", "${NOMAD_PORT_sentinel_1}"
        ]
        volumes = [ "local/sentinel.conf:/local/sentinel.conf" ]
      }

      resources {
        cpu    = 256
        memory = 256
      }
    }

    task "relay-rewards-controller-redis-sentinel-stage-sentinel-2-task" {
      driver = "docker"

      template {
        data = <<-EOT
        bind 0.0.0.0
        sentinel monitor relay-rewards-controller-stage-redis-master {{ env "NOMAD_IP_redis_master" }} {{ env "NOMAD_PORT_redis_master" }} 2
        sentinel resolve-hostnames yes
        sentinel down-after-milliseconds relay-rewards-controller-stage-redis-master 10000
        sentinel failover-timeout relay-rewards-controller-stage-redis-master 10000
        sentinel parallel-syncs relay-rewards-controller-stage-redis-master 1
        EOT
        destination = "local/sentinel.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:latest"
        ports = ["sentinel-2"]
        args = [
          "redis-sentinel",
          "/local/sentinel.conf",
          "--port", "${NOMAD_PORT_sentinel_2}"
        ]
        volumes = [ "local/sentinel.conf:/local/sentinel.conf" ]
      }

      resources {
        cpu    = 256
        memory = 256
      }
    }

    task "relay-rewards-controller-redis-sentinel-stage-sentinel-3-task" {
      driver = "docker"

      template {
        data = <<-EOT
        bind 0.0.0.0
        sentinel monitor relay-rewards-controller-stage-redis-master {{ env "NOMAD_IP_redis_master" }} {{ env "NOMAD_PORT_redis_master" }} 2
        sentinel resolve-hostnames yes
        sentinel down-after-milliseconds relay-rewards-controller-stage-redis-master 10000
        sentinel failover-timeout relay-rewards-controller-stage-redis-master 10000
        sentinel parallel-syncs relay-rewards-controller-stage-redis-master 1
        EOT
        destination = "local/sentinel.conf"
        change_mode = "restart"
      }

      config {
        image = "redis:latest"
        ports = ["sentinel-3"]
        args = [
          "redis-sentinel",
          "/local/sentinel.conf",
          "--port", "${NOMAD_PORT_sentinel_3}"
        ]
        volumes = [ "local/sentinel.conf:/local/sentinel.conf" ]
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
        address_mode = "alloc"
      }
    }

    service {
      name = "relay-rewards-controller-stage-redis-replica-1"
      port = "redis-replica-1"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
        address_mode = "alloc"
      }
    }

    service {
      name = "relay-rewards-controller-stage-redis-replica-2"
      port = "redis-replica-2"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
        address_mode = "alloc"
      }
    }

    service {
      name = "relay-rewards-controller-stage-sentinel-1"
      port = "sentinel-1"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
        address_mode = "alloc"
      }
    }

    service {
      name = "relay-rewards-controller-stage-sentinel-2"
      port = "sentinel-2"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
        address_mode = "alloc"
      }
    }

    service {
      name = "relay-rewards-controller-stage-sentinel-3"
      port = "sentinel-3"

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "3s"
        address_mode = "alloc"
      }
    }
  }
}
