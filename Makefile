PYTHON ?= python3
POETRY ?= poetry
NPM ?= npm
NODE ?= node
PORT ?= 8765
PROJECT_ROOT ?= .forge_project
PROJECT ?=
VERSION = $(shell $(PYTHON) -c 'import runpy; print(runpy.run_path("src/gbc_scene_forge/__init__.py")["__version__"])')
DIST_WHEEL = dist/gbc_scene_forge-$(VERSION)-py3-none-any.whl
DIST_SDIST = dist/gbc_scene_forge-$(VERSION).tar.gz
DEMO_ROOT ?= .demo
CHROME ?=
TILED ?= tiled
RASTERIZER ?= tmxrasterizer
FRONTEND_TEST_FILES := $(sort $(wildcard tests/frontend/*/*.ts))
FRONTEND_TESTS := $(basename $(notdir $(FRONTEND_TEST_FILES)))
FRONTEND_TEST_TARGETS := $(addprefix test-frontend-,$(FRONTEND_TESTS))
.DEFAULT_GOAL := help

.PHONY: typecheck-python help setup check-deps deps frontend run demo check test test-python test-frontend test-browser test-blockout-browser test-layout-browser test-first-use-browser test-standalone-browser test-drafts-browser test-compositions-browser test-definitions-browser test-world-browser test-diagnostics-browser test-tiled lint typecheck format build check-dist clean clean-demo $(FRONTEND_TEST_TARGETS)
help:
	@echo 'Getting started:'
	@echo '  make setup PYTHON=python3.13  Install locked dependencies and build the UI'
	@echo '  make demo                    Reset .demo/ from the checked-in sample and open it'
	@echo '  make run                     Browse/create projects in .forge_project/'
	@echo '  make run PROJECT_ROOT=/path  Browse/create projects in another root'
	@echo '  make run PROJECT=/path       Open one project directly (legacy or exported)'
	@echo '  PORT=8777                    Override the server port for run or demo'
	@echo '  DEMO_ROOT=/path              Override the demo project directory'
	@echo ''
	@echo 'Development and verification:'
	@echo '  make check-deps              Check required tools and the dependency lock'
	@echo '  make frontend                Rebuild the browser UI'
	@echo '  make check                   Run lint, unit/model and browser checks'
	@echo '  make test                    Run Python and TypeScript tests'
	@echo '  make test-python             Run Python tests'
	@echo '  make test-frontend           Run TypeScript model/API/build tests'
	@echo '  make test-frontend-<suite>   Run one suite (model, drafts, contracts, etc.)'
	@echo '  make test-browser            Run all browser acceptance suites (CHROME=/path)'
	@echo '  make test-playwright-browser Run all regular Playwright suites'
	@echo '  make test-blockout-browser   Run artwork-free blockout acceptance'
	@echo '  make test-mcp                Run optional MCP SDK/service checks'
	@echo '  make test-mcp-browser        Run agent/browser draft-conflict acceptance'
	@echo '  make test-layout-browser     Check editor layout and keyboard navigation'
	@echo '  make test-first-use-browser  Run the first-scene Chrome acceptance path'
	@echo '  make test-standalone-browser Run standalone editor Chrome acceptance'
	@echo '  make test-drafts-browser     Run unsaved draft recovery Chrome acceptance'
	@echo '  make test-definitions-browser Run object definition Chrome acceptance'
	@echo '  make test-world-browser     Run world and connection Chrome acceptance'
	@echo '  make test-diagnostics-browser Run project diagnostics Chrome acceptance'
	@echo '  make test-compositions-browser Run clipboard and stamp Chrome acceptance'
	@echo '  make test-tiled              Check Tiled interoperability (TILED=/path RASTERIZER=/path)'
	@echo '  make lint / make format      Check or apply source formatting and lint rules'
	@echo '  make typecheck               Run strict TypeScript checking'
	@echo '  make typecheck-python        Check typed Python storage/service boundaries'
	@echo '  make build / make check-dist Build distributions / test the installed wheel'
	@echo '  make clean                   Remove build outputs and node_modules; keep projects'
	@echo '  make clean-demo              Delete the default .demo/ sample and its edits'

setup: deps

check-deps:
	@for tool in "$(POETRY)" "$(PYTHON)" "$(NPM)" node; do \
		command -v "$$tool" >/dev/null 2>&1 || { \
			echo "Missing required tool: $$tool. See README.md for prerequisites." >&2; exit 1; \
		}; \
	done
	$(POETRY) check --lock --strict

deps: check-deps
	$(POETRY) config virtualenvs.in-project true --local
	$(POETRY) env use $(PYTHON)
	$(NPM) ci --engine-strict
	$(POETRY) sync
	$(MAKE) frontend

frontend:
	$(NPM) run build

run: frontend
	$(POETRY) run python -m gbc_scene_forge $(if $(PROJECT),--project "$(PROJECT)",--project-root "$(PROJECT_ROOT)") --port "$(PORT)"

demo: frontend
	$(POETRY) run python -m gbc_scene_forge.adapters.sample --reset --root "$(DEMO_ROOT)" --port "$(PORT)"

check: lint test test-browser

test: test-python test-frontend

test-python:
	$(POETRY) run python -m unittest discover -s tests -p 'test_*.py'

test-frontend: $(FRONTEND_TEST_TARGETS)

$(FRONTEND_TEST_TARGETS): test-frontend-%:
	$(NODE) $(filter %/$*.ts,$(FRONTEND_TEST_FILES))

test-browser: test-playwright-browser

test-blockout-browser: frontend
	CHROME="$(CHROME)" $(NPM) exec -- playwright test --config tests/playwright/playwright.config.ts blockout.spec.ts

test-layout-browser: frontend
	CHROME="$(CHROME)" $(NPM) exec -- playwright test --config tests/playwright/playwright.config.ts layout.spec.ts

test-first-use-browser: frontend
	CHROME="$(CHROME)" $(NPM) exec -- playwright test --config tests/playwright/playwright.config.ts first-use.spec.ts

test-standalone-browser: frontend
	CHROME="$(CHROME)" $(NPM) exec -- playwright test --config tests/playwright/playwright.config.ts standalone.spec.ts

test-compositions-browser: frontend
	CHROME="$(CHROME)" $(NPM) exec -- playwright test --config tests/playwright/playwright.config.ts compositions.spec.ts

test-diagnostics-browser: frontend
	CHROME="$(CHROME)" $(NPM) exec -- playwright test --config tests/playwright/playwright.config.ts diagnostics.spec.ts

test-world-browser: frontend
	CHROME="$(CHROME)" $(NPM) exec -- playwright test --config tests/playwright/playwright.config.ts world.spec.ts

test-definitions-browser: frontend
	CHROME="$(CHROME)" $(NPM) exec -- playwright test --config tests/playwright/playwright.config.ts definitions.spec.ts

test-drafts-browser: frontend
	CHROME="$(CHROME)" $(NPM) exec -- playwright test --config tests/playwright/playwright.config.ts drafts.spec.ts

test-tiled:
	$(POETRY) run python tests/support/tiled_interop.py --tiled "$(TILED)" --rasterizer "$(RASTERIZER)"

typecheck-python:
	$(POETRY) run mypy

lint:
	$(MAKE) typecheck-python
	$(POETRY) run ruff check .
	$(POETRY) run ruff format --check .
	$(NPM) run lint
	$(NPM) run format:check
	$(MAKE) typecheck

typecheck:
	$(NPM) run typecheck

format:
	$(POETRY) run ruff format .
	$(NPM) run format

build: frontend
	$(POETRY) run python -m build
	$(POETRY) run twine check --strict "$(DIST_WHEEL)" "$(DIST_SDIST)"

check-dist:
	$(PYTHON) -m venv --clear build/package-smoke
	build/package-smoke/bin/python -m pip install --no-index --no-deps "$(DIST_WHEEL)"
	build/package-smoke/bin/python -I tests/packaging/package_smoke.py

clean:
	rm -rf build dist node_modules
	rm -f src/gbc_scene_forge/static/app.js src/gbc_scene_forge/static/app.js.map src/gbc_scene_forge/static/app.meta.json
	rm -f src/gbc_scene_forge/static/project.js src/gbc_scene_forge/static/project.js.map
	rm -f src/gbc_scene_forge/static/build-info.json

clean-demo:
	rm -rf .demo

# Optional protocol checks require the [mcp] extra in FORGE_MCP_PYTHON.
.PHONY: test-mcp test-mcp-browser
test-mcp:
	"$(or $(FORGE_MCP_PYTHON),.venv/bin/python)" -c "import mcp"
	"$(or $(FORGE_MCP_PYTHON),.venv/bin/python)" -m unittest discover -s tests -p 'test_mcp*.py'

test-mcp-browser: frontend
	FORGE_MCP_ONLY=1 FORGE_MCP_PYTHON="$(or $(FORGE_MCP_PYTHON),.venv/bin/python)" CHROME="$(CHROME)" $(NPM) exec -- playwright test --config tests/playwright/playwright.config.ts mcp.spec.ts refresh.spec.ts

.PHONY: test-editor-lifecycle-browser
test-editor-lifecycle-browser: frontend
	CHROME="$(CHROME)" $(NPM) exec -- playwright test --config tests/playwright/playwright.config.ts editor-lifecycle.spec.ts

.PHONY: test-imports-browser
test-imports-browser: frontend
	CHROME="$(CHROME)" $(NPM) exec -- playwright test --config tests/playwright/playwright.config.ts imports.spec.ts

.PHONY: test-terrain-browser
test-terrain-browser: frontend
	CHROME="$(CHROME)" $(NPM) exec -- playwright test --config tests/playwright/playwright.config.ts terrain.spec.ts

.PHONY: test-playwright-browser
test-playwright-browser: frontend
	CHROME="$(CHROME)" $(NPM) run test:playwright
