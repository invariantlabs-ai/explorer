PHONY: test-env tests up build down tester

PORT_HTTP :=  80
PORT_API := 8001


test-env:
	@echo "Building test environment..."
	docker network inspect invariant-explorer-web-test >/dev/null 2>&1 || docker network create invariant-explorer-web-test
	docker compose -f tests/docker-compose.test.yml build
	rm -rf /tmp/invariant-explorer-test/data
    mkdir -p /tmp/invariant-explorer-test/data/database
    mkdir -p /tmp/invariant-explorer-test/data/datasets
    mkdir -p /tmp/invariant-explorer-test/data/images
	docker compose -f tests/docker-compose.test.yml up -d

tester:
	docker build -t 'explorer-test' -f ./tests/Dockerfile.test ./tests

tests: test-env tester
	@until [ "$$(docker inspect -f '{{.State.Health.Status}}' explorer-test-app-api-1)" = "healthy" ]; do \
		echo "Container starting"; \
		sleep 2; \
	done
	@echo "Container explorer-test-app-api-1 is healthy!"
	@curl -k -X POST http://127.0.0.1:$(PORT_HTTP)/api/v1/user/signup
	docker run \
        -e URL="http://127.0.0.1:$(PORT_HTTP)" \
        -e API_SERVER_HTTP_ENDPOINT="http://127.0.0.1:$(PORT_API)" \
        --mount type=bind,source=./tests,target=/tests \
        --network host \
        explorer-test

up:
	docker network inspect invariant-explorer-web >/dev/null 2>&1 || docker network create invariant-explorer-web
	docker compose -f docker-compose.local.yml up -d
	@echo "Frontend at http://127.0.0.1, API at http://127.0.0.1/api/v1"

build:
	docker compose -f docker-compose.local.yml build

down:
	docker compose -f tests/docker-compose.test.yml down
	docker compose -f docker-compose.local.yml down


