# relay rewards controller

## Development

1. TLS CA key - `export NODE_EXTRA_CA_CERTS=$(pwd)/admin-ui-ca.crt`

2. Redis queues - `docker run --name validator_dev_redis -p 6379:6379 redis:7.2`

3. MongoDB store - `docker run --name validator_dev_mongo -p 27017:27017 mongo:5.0`

4. Dependencies - `npm install`

5. Testing - `npm test -- --watch`

6. Running - `npm run start:dev`
