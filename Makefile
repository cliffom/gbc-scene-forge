PYTHON ?= python3
POETRY ?= .tools/poetry/bin/poetry
NPM ?= npm
PORT ?= 8765
DEMO_ROOT ?= .demo
.DEFAULT_GOAL := test

.PHONY: setup deps frontend demo test lint typecheck format build check-dist clean clean-demo
setup:
	$(PYTHON) tools/bootstrap_poetry.py
	$(MAKE) deps

deps:
	test -x .venv/bin/python || .tools/poetry/bin/python -m venv .venv
	$(POETRY) config virtualenvs.in-project true --local
	$(POETRY) check --lock --strict
	$(NPM) ci
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
	$(POETRY) run python tools/check_dist.py

check-dist: build

clean:
	rm -rf build dist node_modules

clean-demo:
	rm -rf .demo
