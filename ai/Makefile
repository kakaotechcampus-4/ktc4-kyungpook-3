VENV := .venv
PYTHON := $(VENV)/bin/python

.PHONY: setup run test clean

setup:
	uv venv --python 3.12 $(VENV)
	uv pip install --python $(PYTHON) -r requirements.txt
	test -f .env || cp .env.example .env

run:
	$(PYTHON) -m capture.run_recorder

test:
	$(PYTHON) -m pytest

clean:
	rm -rf $(VENV) **/__pycache__ .pytest_cache
