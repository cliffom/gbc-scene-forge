PYTHON ?= python3
POETRY ?= poetry
NPM ?= npm
PORT ?= 8765
DEMO_ROOT ?= .demo
.DEFAULT_GOAL := test

.PHONY: setup check-deps deps frontend demo test lint typecheck format build check-dist clean clean-demo
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
	$(MAKE) frontend
	$(POETRY) sync

frontend:
	$(NPM) run build

demo: frontend
	$(POETRY) run python -m gbc_scene_forge.demo --root "$(DEMO_ROOT)" --port "$(PORT)"

test:
	$(POETRY) run python -m unittest discover -s tests -p 'test_*.py'
	$(NPM) test

lint:
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
	$(POETRY) run twine check --strict dist/*

check-dist:
	$(PYTHON) -m venv --clear build/package-smoke
	build/package-smoke/bin/python -m pip install --no-index --no-deps dist/*.whl
	build/package-smoke/bin/python -I tests/package_smoke.py

clean:
	rm -rf build dist node_modules
	rm -f src/gbc_scene_forge/static/app.js src/gbc_scene_forge/static/app.js.map src/gbc_scene_forge/static/app.meta.json
	rm -f src/gbc_scene_forge/static/project.js src/gbc_scene_forge/static/project.js.map

clean-demo:
	rm -rf .demo
