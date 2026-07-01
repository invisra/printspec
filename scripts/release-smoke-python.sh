#!/usr/bin/env bash
set -euo pipefail

python -m pip install --upgrade pip
python -m pip install -e "packages/python[test]"
pytest tests/python tests/schema
python -m pip install build twine
rm -rf packages/python/dist
python -m build packages/python
python -m twine check packages/python/dist/*
python -m pip install --force-reinstall packages/python/dist/*.whl
python -m printspec.cli validate examples/part-families/rounded-rectangular-plate.basic.json
python -m printspec.cli --version
python -m printspec.cli bundle examples/part-families/rounded-rectangular-plate.basic.json --output /tmp/printspec-bundle --overwrite
