PYTHON ?= python3
POETRY ?= .tools/poetry/bin/poetry
NODE ?= node
PORT ?= 8765
DEMO_ROOT ?= .demo
.DEFAULT_GOAL := test

.PHONY: setup deps run test lint build check-dist clean clean-demo
setup:
	$(PYTHON) tools/bootstrap_poetry.py
	$(MAKE) deps

deps:
	test -x .venv/bin/python || .tools/poetry/bin/python -m venv .venv
	$(POETRY) config virtualenvs.in-project true --local
	$(POETRY) check --lock --strict
	$(POETRY) sync

run:
	$(POETRY) run python -m gbc_scene_forge.demo --root "$(DEMO_ROOT)" --port "$(PORT)"

test:
	$(POETRY) run python -m unittest discover -s tests -p 'test_*.py'
	$(NODE) tests/model.mjs

lint:
	$(POETRY) run ruff check .
	$(POETRY) run ruff format --check .

build:
	$(POETRY) run python -m build
	$(POETRY) run twine check --strict dist/*
	$(POETRY) run python tools/check_dist.py

check-dist: build

clean:
	rm -rf build dist

clean-demo:
	rm -rf .demo
