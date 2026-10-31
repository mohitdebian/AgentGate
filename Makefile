.PHONY: setup dev test lint build up down verify demo benchmark

setup:
	@echo "Setting up AgentGate..."
	cd proxy && npx --yes pnpm install
	cd dashboard && npx --yes pnpm install
	cd decision && uv sync --extra dev

dev:
	@echo "Starting dev servers..."

test:
	@echo "Running tests..."
	cd proxy && npx --yes pnpm test
	cd dashboard && npx --yes pnpm test
	cd decision && uv run --extra dev pytest

lint:
	@echo "Running lint..."
	cd proxy && npx --yes pnpm lint
	cd dashboard && npx --yes pnpm lint
	cd decision && uv run --extra dev ruff check .

build:
	@echo "Building packages..."
	cd proxy && npx --yes pnpm build
	cd dashboard && npx --yes pnpm build

verify:
	@echo "Running automated security verification suite..."
	node test_scripts/verify_attacks.js

demo:
	@echo "Running streaming agent simulation..."
	node test_scripts/stream_simulation.js

benchmark:
	@echo "Running 100-request concurrent load test..."
	node test_scripts/load_test.js

up:
	docker compose up --build -d

down:
	docker compose down
