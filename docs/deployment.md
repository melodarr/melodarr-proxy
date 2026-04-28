# Deployment Manifests & Strategy

This document outlines the deployment configurations for Jenkins and VMware Tanzu (Cloud Foundry) to support the Lidarr-Lite-Proxy.

## 1. Tanzu `manifest.yml`

This manifest configures the deployment for VMware Tanzu. It defines the proxy application.

```yaml
---
applications:
  - name: lidarr-lite-proxy
    memory: 256M
    instances: 2
    buildpacks:
      - nodejs_buildpack
    env:
      NODE_ENV: production
      PORT: 3000
      # Provide external Redis URL
      REDIS_URL: ((redis_url))
    command: node src/server.js
```

## 2. Jenkinsfile (CI/CD Pipeline)

This pipeline builds the Docker image for the Proxy.

```groovy
pipeline {
    agent any

    environment {
        REGISTRY = "ghcr.io"
        IMAGE_NAME = "jasonwalker/lidarr-lite-proxy"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build Proxy') {
            steps {
                sh 'docker build --target production -t ${REGISTRY}/${IMAGE_NAME}:latest .'
            }
        }

        stage('Deploy to Tanzu') {
            steps {
                withCredentials([usernamePassword(credentialsId: 'tanzu-credentials', usernameVariable: 'CF_USER', passwordVariable: 'CF_PASS')]) {
                    sh '''
                        cf login -a api.sys.tanzu.local -u $CF_USER -p $CF_PASS -o my-org -s production
                        cf push
                    '''
                }
            }
        }
    }
}
```

## 3. Deployment Considerations

*   **Redis Failover:** The proxy backend handles Redis outages automatically using in-memory circuit breakers. If Redis restarts or goes down, nodes will seamlessly fall back to degraded mode and recover once the connection is restored without causing "thundering herd" issues.
