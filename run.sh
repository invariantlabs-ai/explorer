#!/usr/bin/env bash
#
# Usage: ./run.sh [test-env|tester|tests|tests-setup|up|build|down]
#

# -----------------------------
# Configuration
# -----------------------------
PORT_HTTP=80
PORT_API=8001

# -----------------------------
# Functions corresponding to
# each Make target
# -----------------------------

test_env() {
  echo "Building test environment..."
  
  # Ensure test network exists
  docker network inspect invariant-explorer-web-test >/dev/null 2>&1 || \
    docker network create invariant-explorer-web-test
  
  # Clean & recreate test data directories
  rm -rf /tmp/invariant-explorer-test/data
  mkdir -p /tmp/invariant-explorer-test/data/database
  mkdir -p /tmp/invariant-explorer-test/data/datasets
  mkdir -p /tmp/invariant-explorer-test/data/images
  
  # Start containers
  docker compose -f tests/docker-compose.test.yml down
  docker compose -f tests/docker-compose.test.yml build
  docker compose -f tests/docker-compose.test.yml up -d
}

build_tester() {
  # Build the 'explorer-test' image using the Dockerfile in ./tests
  docker build -t 'explorer-test' -f ./tests/Dockerfile.test ./tests
}

tests() {
  echo "Building tester container..."
  # Wait until the test API container is healthy
  until [ "$(docker inspect -f '{{.State.Health.Status}}' explorer-test-app-api-1)" = "healthy" ]; do
    echo "Container starting..."
    sleep 2
  done
  echo "Container explorer-test-app-api-1 is healthy!"
  
  # Simple test call to your app
  curl -k -X POST http://127.0.0.1:"${PORT_HTTP}"/api/v1/user/signup
  
  # Run tests in the 'explorer-test' container
  docker run \
    -e URL="http://127.0.0.1:${PORT_HTTP}" \
    -e API_SERVER_HTTP_ENDPOINT="http://127.0.0.1:${PORT_API}" \
    --mount type=bind,source=./tests,target=/tests \
    --network host \
    explorer-test $@
}

tests_local() {
  test_env
  build_tester
  tests $@
}

up() {
  # Ensure the main network exists
  docker network inspect invariant-explorer-web >/dev/null 2>&1 || \
    docker network create invariant-explorer-web
  
  # Start your local docker-compose services
  docker compose -f docker-compose.local.yml up -d
  
  echo "Frontend at http://127.0.0.1"
  echo "API at http://127.0.0.1/api/v1"
}

build() {
  # Build local services
  docker compose -f docker-compose.local.yml build 
}

down() {
  # Bring down test services
  docker compose -f tests/docker-compose.test.yml down
  # Bring down local services
  docker compose -f docker-compose.local.yml down
}

setup-venv() {
  python -m venv venv
  source venv/bin/activate
  pip install --upgrade pip
  pip install pip-tools
}

compile_requirements() {
  # Compile requirements.txt for tests/
  setup-venv
  pip-compile --output-file=tests/requirements.txt tests/requirements.in
  
  # Compile requirements.txt for docker-compose.local.yml (this must happen in container, as it may use packages
  # that are not available on the host architecture (arm64))
  
  # first stop the containers
  docker compose -f docker-compose.local.yml down
  # then start the containers 
  docker compose -f docker-compose.local.yml up -d
  # then run the command in the container
  docker exec -it explorer-app-api-1 bash -c "pip install pip-tools && pip-compile --output-file=/srv/app/requirements.txt /srv/app/requirements.in"
}
# -----------------------------
# Command dispatcher
# -----------------------------
case "$1" in
  "test-env")
    test_env
    ;;
  "build-tester")
    build_tester
    ;;
  "tests")
    shift         
    tests $@
    ;;
  "tests-local")
    shift         
    tests_local $@
    ;;
  "up")
    up
    ;;
  "build")
    build
    ;;
  "down")
    down
    ;;
  "logs")
    docker compose -f docker-compose.local.yml logs -f
    ;;
  "compile-requirements")
    compile_requirements
    ;;
  *)
    echo "Usage: $0 [test-env|build-tester|tests|tests-local|up|build|down|compile-requirements|logs]"
    exit 1
    ;;
esac
