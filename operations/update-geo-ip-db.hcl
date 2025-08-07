job "update-geo-ip-db" {
  datacenters = ["ator-fin"]
  type = "batch"
  namespace = "live-services"
  
  periodic {
    crons            = ["0 3 * * 7"] # every Sunday at 3am
    prohibit_overlap = true
  }
  
  group "update-geo-ip-db-group" {
    
    count = 2
  	
    volume "geo-ip-db" {
      type      = "host"
      read_only = false
      source    = "geo-ip-db"
    }
  
    task "update-geo-ip-db-task" {
      driver = "docker"
      
      volume_mount {
        volume      = "geo-ip-db"
        destination = "/geo-ip-db"
        read_only   = false
      }

      env {
        GEODATADIR="/geo-ip-db/data"
        GEOTMPDIR="/geo-ip-db/tmp"
      }
      
      vault {
        role = "any1-nomad-workloads-controller"
      }

      template {
        data = <<EOH
          {{with secret "kv/live-services/update-geo-ip-db"}}
            LICENSE_KEY="{{.Data.data.LICENSE_KEY}}"
          {{end}}
        EOH
        destination = "secrets/file.env"
        env         = true
      }
      
      config {
        image = "ghcr.io/anyone-protocol/relay-rewards-controller:[[.deploy]]"
        entrypoint = ["node"]
        args = [
            "./node_modules/geoip-lite/scripts/updatedb.js",
            "license_key=$LICENSE_KEY"
        ]
      }
    }
  }
}